import asyncio
import json
from pathlib import Path

from core.devtools.net_stats import NetStats, Sample, classify_key, payload_timestamp
from core.devtools.service import ip_from_locator, read_net_bytes
from models.camera import CommandResult


def test_classify_key():
    assert classify_key("devices/iot-01/state") == ("iot-01", "state")
    assert classify_key("devices/iot-01/cameras/front/state") == ("iot-01", "camera_state")
    assert classify_key("devices/iot-01/cameras/front/webrtc/to-backend") == ("iot-01", "camera_webrtc_to_backend")
    assert classify_key("anomalies/a1/state") == ("anomalies", "state")
    assert classify_key("other/thing") is None


def test_payload_timestamp():
    assert payload_timestamp(b'{"timestamp": 12.5}') == 12.5
    assert payload_timestamp(b'{"timestamp": "1970-01-01T00:00:10Z"}') == 10.0
    assert payload_timestamp(b'{"x": 1}') is None
    assert payload_timestamp(b"not json") is None


def test_ip_from_locator():
    assert ip_from_locator("tcp/[::ffff:192.168.1.7]:41234") == "192.168.1.7"
    assert ip_from_locator("tcp/10.0.0.5:7447") == "10.0.0.5"
    assert ip_from_locator("tcp/[fe80::1]:7447") == "fe80::1"


def test_window_rate_jitter_and_gaps():
    stats = NetStats()
    t = 100.0
    for _ in range(10):
        stats.add(Sample(t, "iot-01", "state", 200, t - 0.05, t))
        t += 0.1
    t += 1.0  # 1.1 s silence on a 10 Hz stream
    stats.add(Sample(t, "iot-01", "state", 200, None, t))

    rows = stats.collect(t, 2.0)
    (row,) = rows
    assert row["count"] == 11
    assert row["rate_hz"] == 5.5
    assert row["gaps"] == 1
    assert abs(row["gap_ms_max"] - 1100) < 1
    assert abs(row["latency_ms_p50"] - 50) < 1
    assert abs(row["kbps"] - 11 * 200 * 8 / 1000 / 2) < 1e-9

    rows = stats.collect(t + 1, 1.0)
    assert rows[0]["count"] == 0
    assert rows[0]["total_gaps"] == 1
    assert abs(rows[0]["silent_s"] - 1) < 1e-9


def test_aperiodic_streams_count_no_gaps():
    stats = NetStats()
    for t in [0, 0.1, 0.2, 0.3, 0.4, 0.5, 5.0]:
        stats.add(Sample(t, "iot-01", "events", 10, None, t))
    rows = stats.collect(5.0, 1.0)
    assert rows[0]["gaps"] == 0
    assert rows[0]["expected_hz"] is None


def _records(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_read_net_bytes(tmp_path):
    dev = tmp_path / "dev"
    dev.write_text(
        "Inter-|   Receive\n face |bytes\n"
        "    lo: 500 5 0 0 0 0 0 0 500 5 0 0 0 0 0 0\n"
        "  eth0: 1000 10 0 0 0 0 0 0 400 4 0 0 0 0 0 0\n"
    )
    assert read_net_bytes(dev) == (1000, 400)
    assert read_net_bytes(tmp_path / "missing") is None


def _result(command: str, timestamp: str) -> CommandResult:
    return CommandResult(request_id="r", device_id="robot-1", command=command, status="rejected", timestamp=timestamp)


def test_recording_run(client, services, settings):
    assert client.post("/api/dev/runs").status_code == 200
    assert client.post("/api/dev/runs").status_code == 409

    devtools = services.devtools
    devtools._stats.add(Sample(1.0, "iot-01", "state", 100, 0.9))
    devtools._on_command_result(_result("navigate_to_goal", "2026-11-10T00:00:00.000Z"), 0.0, 12.5)
    devtools._on_command_result(_result("time_probe", "1970-01-01T00:00:10.050Z"), 10.0, 20.0)
    devtools._event("disconnect", "iot-01")
    devtools.record_browser({"webrtc": [{"device_id": "iot-01", "fps": 30}], "ws_rtt_ms": 4.2})
    asyncio.run(devtools._tick())
    asyncio.run(devtools._tick())
    run_id = client.post("/api/dev/runs/stop").json()["run_id"]

    records = _records(Path(settings.runs_dir) / run_id / "record.jsonl")
    by_type = {}
    for r in records:
        by_type.setdefault(r["type"], []).append(r)
    assert records[0]["type"] == "meta" and records[-1]["type"] == "end"
    assert by_type["window"][0]["stream"] == "state"
    assert by_type["command"][0]["rtt_ms"] == 12.5
    assert len(by_type["command"]) == 1
    assert abs(by_type["clock"][0]["offset_ms"] - 40.0) < 1e-6  # device 50 ms ahead of send, 10 ms one way
    assert by_type["event"][0]["kind"] == "disconnect"
    assert by_type["video"][0]["fps"] == 30
    assert by_type["ws"][0]["rtt_ms"] == 4.2
    assert "ui_kbps" in by_type["traffic"][0]
    assert all("t" in r for r in records)

    assert client.post("/api/dev/runs/stop").json()["run_id"] is None


def test_ws_ping_and_manual_target(client):
    with client.websocket_connect("/api/dev/ws") as ws:
        ws.send_text(json.dumps({"type": "ping", "t": 123}))
        reply = ws.receive_json()
        while reply["type"] != "pong":
            reply = ws.receive_json()
        assert reply["t"] == 123

    status = client.put("/api/dev/targets/iot-01", json={"ip": "192.168.1.159"}).json()
    assert status["manual_ips"] == {"iot-01": "192.168.1.159"}
    assert client.put("/api/dev/targets/iot-01", json={"ip": None}).json()["manual_ips"] == {}


def test_command_round_trip_reaches_devtools(services, monkeypatch):
    gateway = services.zenoh_gateway
    monkeypatch.setattr(gateway, "_put", lambda *args: True)
    seen = []
    gateway.command_result_listener = lambda result, sent_at, rtt: seen.append((result.device_id, result.command, rtt))
    gateway.publish_command("robot-1", "navigate_to_goal", "r1")
    gateway.ingest_command_result_payload({
        "request_id": "r1", "device_id": "robot-1", "command": "navigate_to_goal",
        "status": "accepted", "timestamp": "2026-11-10T00:00:00Z",
    })
    gateway.ingest_command_result_payload({
        "request_id": "r1", "device_id": "robot-1", "command": "navigate_to_goal",
        "status": "succeeded", "timestamp": "2026-11-10T00:00:01Z",
    })
    assert [(d, c) for d, c, _ in seen] == [("robot-1", "navigate_to_goal")]
    assert seen[0][2] >= 0


def test_probes_only_connected_devices(services, monkeypatch):
    devtools = services.devtools
    sent = []
    monkeypatch.setattr(devtools._gateway, "publish_command", lambda device, command, request_id: sent.append((device, command)))
    devtools._links = {"iot-01": {"zenoh_connected": True}, "iot-02": {"zenoh_connected": False}}
    devtools._probe_clocks()
    assert sent == [("iot-01", "time_probe")]
