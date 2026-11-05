import asyncio
import json
import logging
import os
import re
import time

from fastapi import WebSocket

from core.device_registry import DeviceRegistry
from core.net_stats import NetStats, Sample, classify_key, payload_timestamp
from core.run_recorder import RunRecorder
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)

TAP_KEYS = ["devices/**", "anomalies/*/state"]
# Sent by this backend, not received from devices.
OUTBOUND_STREAMS = {"commands", "camera_commands", "camera_webrtc_to_device"}
LINK_REFRESH_SEC = 2.0
PING_TIMEOUT_SEC = 0.9
_COMMANDS_SUBSCRIBER_RE = re.compile(r"/subscriber/devices/([^/*$]+)/commands$")


def ip_from_locator(locator: str) -> str:
    """tcp/[::ffff:10.0.0.5]:41234 -> 10.0.0.5"""
    address = locator.split("/", 1)[-1].rsplit(":", 1)[0].strip("[]")
    return address.removeprefix("::ffff:")


class DevtoolsService:
    """Measures the device links for the /dev page. Idle (no subscription,
    no pings) unless a /dev page is open or a run is recording."""

    def __init__(self, runs_dir: str, runs_owner: str | None, zenoh_gateway: ZenohGateway, device_registry: DeviceRegistry) -> None:
        self._gateway = zenoh_gateway
        self._devices = device_registry
        self.recorder = RunRecorder(runs_dir, runs_owner)
        self._stats = NetStats()
        self._clients: set[WebSocket] = set()
        self._subscribers: list = []
        self._links: dict[str, dict] = {}
        self.manual_ips: dict[str, str] = {}
        self._links_at = 0.0
        self._last_collect = time.monotonic()
        self._pings: list[dict] = []
        self.ping_error: str | None = None

    @property
    def active(self) -> bool:
        return bool(self._clients) or self.recorder.run_id is not None

    def add_client(self, websocket: WebSocket) -> None:
        self._clients.add(websocket)

    def remove_client(self, websocket: WebSocket) -> None:
        self._clients.discard(websocket)

    def status(self) -> dict:
        return {
            "recording": self.recorder.run_id,
            "started_at": self.recorder.started_at,
            "ping_error": self.ping_error,
            "manual_ips": self.manual_ips,
        }

    def _device_ips(self) -> dict:
        return {d: link.get("ip") for d, link in self._links.items()} | self.manual_ips

    def start_recording(self, label: str, notes: str) -> str:
        run_id = self.recorder.start(label, notes, {"devices": self._device_ips()})
        self._stats.keep_samples = True
        return run_id

    def stop_recording(self) -> str | None:
        self._stats.keep_samples = False
        self.recorder.update_meta({"devices": self._device_ips()})
        return self.recorder.stop()

    def record_browser(self, message: dict) -> None:
        t = time.time()
        webrtc = message.get("webrtc")
        if isinstance(webrtc, list):
            self.recorder.write("webrtc", [{"t": t} | row for row in webrtc if isinstance(row, dict)])
        rtt = message.get("ws_rtt_ms")
        if isinstance(rtt, (int, float)):
            self.recorder.write("ws", [{"t": t, "rtt_ms": rtt}])

    def _on_sample(self, sample) -> None:
        received, mono = time.time(), time.monotonic()
        key = str(sample.key_expr)
        classified = classify_key(key)
        if classified is None or classified[1] in OUTBOUND_STREAMS:
            return
        device_id, stream = classified
        payload = bytes(sample.payload)
        if device_id == "anomalies":
            try:
                device_id, stream = json.loads(payload)["source_device_id"], "anomaly"
            except (ValueError, KeyError, TypeError):
                return
        self._stats.add(Sample(received, device_id, stream, len(payload), payload_timestamp(payload), mono))

    def _update_tap(self) -> None:
        if self.active and not self._subscribers:
            for key in TAP_KEYS:
                subscriber = self._gateway.declare_subscriber(key, self._on_sample)
                if subscriber is not None:
                    self._subscribers.append(subscriber)
            self._last_collect = time.monotonic()
        elif not self.active and self._subscribers:
            for subscriber in self._subscribers:
                subscriber.undeclare()
            self._subscribers = []
            self._stats.reset()

    @staticmethod
    async def _every_second():
        """Fixed 1 s schedule on the monotonic clock."""
        next_tick = time.monotonic()
        while True:
            next_tick += 1.0
            delay = next_tick - time.monotonic()
            if delay < 0:
                next_tick, delay = time.monotonic(), 0.0
            await asyncio.sleep(delay)
            yield

    def _refresh_links(self) -> None:
        device_zids: dict[str, str] = {}
        for key, payload in self._gateway.query("@/*/router/subscriber/devices/*/commands"):
            match = _COMMANDS_SUBSCRIBER_RE.search(key)
            clients = json.loads(payload).get("clients") or []
            if match and clients:
                device_zids[match.group(1)] = clients[0]
        zid_ips: dict[str, str] = {}
        for _, payload in self._gateway.query("@/*/router"):
            for session in json.loads(payload).get("sessions", []):
                for link in session.get("links", []):
                    zid_ips[session["peer"]] = ip_from_locator(link["dst"])

        known = set(device_zids) | set(self._links) | {d.device_id for d in self._devices.list_devices()}
        for device_id in known:
            link = self._links.setdefault(device_id, {"ip": None, "zenoh_session": None, "reconnects": 0})
            zid = device_zids.get(device_id)
            connected = zid is not None and zid in zid_ips
            if connected:
                if link["zenoh_session"] not in (None, zid):
                    link["reconnects"] += 1
                link["zenoh_session"] = zid
                link["ip"] = zid_ips[zid]
            link["zenoh_connected"] = connected

    @staticmethod
    async def _ping(t: float, device_id: str, ip: str) -> dict:
        from icmplib import async_ping

        host = await async_ping(ip, count=1, timeout=PING_TIMEOUT_SEC, privileged=os.geteuid() == 0)
        rtt = host.avg_rtt if host.is_alive else None
        return {"t": t, "device_id": device_id, "ip": ip, "rtt_ms": rtt, "lost": not host.is_alive}

    async def run_pings(self) -> None:
        async for _ in self._every_second():
            if not self.active:
                continue
            targets = {d: link["ip"] for d, link in self._links.items() if link.get("ip")} | self.manual_ips
            if not targets:
                continue
            t = time.time()
            results = await asyncio.gather(*(self._ping(t, d, ip) for d, ip in targets.items()), return_exceptions=True)
            errors = [r for r in results if isinstance(r, BaseException)]
            self.ping_error = f"{type(errors[0]).__name__}: {errors[0]}" if errors else None
            self._pings.extend(r for r in results if isinstance(r, dict))

    async def run(self) -> None:
        async for _ in self._every_second():
            try:
                await self._tick()
            except Exception:
                logger.warning("Devtools tick failed", exc_info=True)

    async def _tick(self) -> None:
        self._update_tap()
        if not self.active:
            return
        now, mono = time.time(), time.monotonic()
        if mono - self._links_at >= LINK_REFRESH_SEC:
            self._links_at = mono
            await asyncio.to_thread(self._refresh_links)

        windows, samples = self._stats.collect(mono, mono - self._last_collect)
        self._last_collect = mono
        pings, self._pings = self._pings, []
        links = [{"device_id": d} | link for d, link in sorted(self._links.items())]
        robots = [
            {
                "device_id": d.device_id, "x": d.pose.x, "y": d.pose.y, "yaw": d.pose.yaw,
                "lat": d.pose.lat, "lon": d.pose.lon, "connected": d.connected,
            }
            for d in self._devices.list_devices()
            if d.type == "robot"
        ]

        if self.recorder.run_id:
            self.recorder.write("windows", [{"t": now} | w for w in windows])
            self.recorder.write("samples", [
                {"t": s.t, "device_id": s.device_id, "stream": s.stream, "bytes": s.size,
                 "payload_ts": s.payload_ts, "latency_ms": s.latency_ms}
                for s in samples
            ])
            self.recorder.write("ping", pings)
            self.recorder.write("links", [{"t": now} | link for link in links])
            self.recorder.write("robot", [{"t": now} | r for r in robots])

        message = {
            "type": "dev.window",
            "data": {"t": now, "streams": windows, "pings": pings, "links": links, "status": self.status()},
        }
        await asyncio.gather(*(self._send(ws, message) for ws in list(self._clients)))

    async def _send(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except Exception:
            self.remove_client(websocket)
