import asyncio
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import WebSocket

from core.device_registry import DeviceRegistry
from core.devtools.net_stats import NetStats, Sample, classify_key, payload_timestamp
from core.devtools.recorder import RunRecorder
from core.websocket_manager import WebSocketManager
from models.camera import CommandResult
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)

TAP_KEYS = ["devices/**", "anomalies/*/state"]
# Sent by this backend, not received from devices.
OUTBOUND_STREAMS = {"commands", "camera_webrtc_to_device"}
LINK_REFRESH_SEC = 2.0
PING_TIMEOUT_SEC = 0.9
NET_DEV = Path("/proc/net/dev")
# Unknown to zenoh_bridge, so it is rejected at once with the device's
# clock in the result: an NTP-style offset estimate, good to ±RTT/2.
PROBE_COMMAND = "time_probe"
PROBE_SEC = 5.0
_COMMANDS_SUBSCRIBER_RE = re.compile(r"/subscriber/devices/([^/*$]+)/commands$")


def ip_from_locator(locator: str) -> str:
    """tcp/[::ffff:10.0.0.5]:41234 -> 10.0.0.5"""
    address = locator.split("/", 1)[-1].rsplit(":", 1)[0].strip("[]")
    return address.removeprefix("::ffff:")


def read_net_bytes(path: Path = NET_DEV) -> tuple[int, int] | None:
    """(received, sent) bytes over every interface but loopback. In Docker
    that is the backend container's own traffic."""
    try:
        lines = path.read_text().splitlines()[2:]
    except OSError:
        return None
    rx = tx = 0
    for line in lines:
        name, _, fields = line.partition(":")
        if name.strip() == "lo":
            continue
        values = fields.split()
        rx += int(values[0])
        tx += int(values[8])
    return rx, tx


class DevtoolsService:
    """Measures the links between the devices and this backend for /dev ›
    Network, and records them. Idle (no subscription, no pings) unless a
    /dev page is open or a run is recording."""

    def __init__(
        self,
        runs_dir: str,
        runs_owner: str | None,
        zenoh_gateway: ZenohGateway,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._gateway = zenoh_gateway
        self._devices = device_registry
        self._websocket = websocket_manager
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
        # Filled from other threads (Zenoh, link refresh), drained each tick.
        self._lock = threading.Lock()
        self._commands: list[dict] = []
        self._clocks: list[dict] = []
        self._probed_at = 0.0
        self._events: list[dict] = []
        self._traffic: tuple[float, tuple[int, int] | None, int] | None = None
        zenoh_gateway.command_result_listener = self._on_command_result

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

    def start_recording(self) -> str:
        return self.recorder.start({"devices": self._device_ips(), "traffic_scope": self._traffic_scope()})

    def stop_recording(self) -> str | None:
        return self.recorder.stop({"devices": self._device_ips()})

    @staticmethod
    def _traffic_scope() -> str:
        return "container" if Path("/.dockerenv").exists() else "host"

    def record_browser(self, message: dict) -> None:
        t = time.time()
        video = message.get("webrtc")
        if isinstance(video, list):
            self.recorder.write("video", [{"t": t} | row for row in video if isinstance(row, dict)])
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

    def _on_command_result(self, result: CommandResult, sent_at: float, rtt_ms: float) -> None:
        if not self.active:
            return
        row = {"t": time.time(), "device_id": result.device_id, "rtt_ms": rtt_ms}
        if result.command != PROBE_COMMAND:
            with self._lock:
                self._commands.append(row | {"command": result.command})
            return
        try:
            device_time = datetime.fromisoformat(result.timestamp.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return
        midpoint = sent_at + rtt_ms / 2000
        with self._lock:
            self._clocks.append(row | {"offset_ms": (device_time - midpoint) * 1000})

    def _probe_clocks(self) -> None:
        for device_id, link in list(self._links.items()):
            if link.get("zenoh_connected"):
                self._gateway.publish_command(device_id, PROBE_COMMAND, uuid.uuid4().hex)

    def _event(self, kind: str, device_id: str, **fields) -> None:
        with self._lock:
            self._events.append({"t": time.time(), "kind": kind, "device_id": device_id} | fields)

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
            self._traffic = None

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

        now = time.monotonic()
        known = set(device_zids) | set(self._links) | {d.device_id for d in self._devices.list_devices()}
        for device_id in known:
            link = self._links.setdefault(
                device_id, {"ip": None, "zenoh_session": None, "zenoh_connected": None, "reconnects": 0}
            )
            zid = device_zids.get(device_id)
            connected = zid is not None and zid in zid_ips
            was = link["zenoh_connected"]
            if was and not connected:
                link["down_since"] = now
                self._event("disconnect", device_id)
            elif connected and (was is False or link["zenoh_session"] not in (None, zid)):
                link["reconnects"] += 1
                down_since = link.pop("down_since", None)
                self._event("reconnect", device_id, downtime_s=now - down_since if down_since else 0.0)
            if connected:
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

    def _traffic_window(self, mono: float) -> dict | None:
        """Backend traffic since the last tick: network in/out and what went
        to the browsers over the UI WebSocket."""
        net, ws = read_net_bytes(), self._websocket.bytes_sent
        previous, self._traffic = self._traffic, (mono, net, ws)
        if previous is None:
            return None
        then, net_then, ws_then = previous
        seconds = mono - then
        if seconds <= 0:
            return None
        row = {"ui_kbps": (ws - ws_then) * 8 / 1000 / seconds}
        if net and net_then:
            row |= {
                "rx_kbps": (net[0] - net_then[0]) * 8 / 1000 / seconds,
                "tx_kbps": (net[1] - net_then[1]) * 8 / 1000 / seconds,
            }
        return row

    async def _tick(self) -> None:
        self._update_tap()
        if not self.active:
            return
        now, mono = time.time(), time.monotonic()
        if mono - self._links_at >= LINK_REFRESH_SEC:
            self._links_at = mono
            await asyncio.to_thread(self._refresh_links)
        if mono - self._probed_at >= PROBE_SEC:
            self._probed_at = mono
            await asyncio.to_thread(self._probe_clocks)

        windows = [{"t": now} | w for w in self._stats.collect(mono, mono - self._last_collect)]
        self._last_collect = mono
        for w in windows:
            if w["gaps"]:
                self._event("gap", w["device_id"], stream=w["stream"], gap_ms=w["gap_ms_max"])
        pings, self._pings = self._pings, []
        with self._lock:
            commands, self._commands = self._commands, []
            clocks, self._clocks = self._clocks, []
            events, self._events = self._events, []
        traffic = self._traffic_window(mono)
        links = [
            {"t": now, "device_id": d} | {k: v for k, v in link.items() if k != "down_since"}
            for d, link in sorted(self._links.items())
        ]
        poses = [
            {
                "t": now, "device_id": d.device_id, "x": d.pose.x, "y": d.pose.y, "yaw": d.pose.yaw,
                "lat": d.pose.lat, "lon": d.pose.lon, "connected": d.connected,
            }
            for d in self._devices.list_devices()
            if d.type == "robot" and d.pose is not None  # None: not localized
        ]

        if self.recorder.run_id:
            for kind, rows in [
                ("window", windows), ("ping", pings), ("link", links), ("pose", poses),
                ("command", commands), ("clock", clocks), ("event", events), ("traffic", [{"t": now} | traffic] if traffic else []),
            ]:
                self.recorder.write(kind, rows)

        message = {
            "type": "dev.window",
            "data": {
                "t": now, "streams": windows, "pings": pings, "links": links, "commands": commands, "clocks": clocks,
                "events": events, "traffic": traffic, "status": self.status(),
            },
        }
        await asyncio.gather(*(self._send(ws, message) for ws in list(self._clients)))

    async def _send(self, websocket: WebSocket, message: dict) -> None:
        try:
            await websocket.send_json(message)
        except Exception:
            self.remove_client(websocket)
