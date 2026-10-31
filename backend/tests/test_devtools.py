import csv
import json
from pathlib import Path

import yaml

from core.devtools import ip_from_locator
from core.net_stats import NetStats, Sample, classify_key, payload_timestamp


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

    rows, _ = stats.collect(t, 2.0)
    (row,) = rows
    assert row["count"] == 11
    assert row["rate_hz"] == 5.5
    assert row["gaps"] == 1
    assert abs(row["gap_ms_max"] - 1100) < 1
    assert abs(row["latency_ms_p50"] - 50) < 1
    assert abs(row["kbps"] - 11 * 200 * 8 / 1000 / 2) < 1e-9

    rows, _ = stats.collect(t + 1, 1.0)
    assert rows[0]["count"] == 0
    assert rows[0]["total_gaps"] == 1
    assert abs(rows[0]["silent_s"] - 1) < 1e-9


def test_aperiodic_streams_count_no_gaps():
    stats = NetStats()
    for t in [0, 0.1, 0.2, 0.3, 0.4, 0.5, 5.0]:
        stats.add(Sample(t, "iot-01", "events", 10, None, t))
    rows, _ = stats.collect(5.0, 1.0)
    assert rows[0]["gaps"] == 0
    assert rows[0]["expected_hz"] is None


def _read(path: Path) -> list[dict]:
    with path.open() as f:
        return list(csv.DictReader(f))


def test_recording_run(client, services, settings):
    assert client.post("/api/dev/runs", json={"label": "field 1"}).status_code == 200
    assert client.post("/api/dev/runs", json={}).status_code == 409

    devtools = services.devtools
    devtools._stats.add(Sample(1.0, "iot-01", "state", 100, 0.9))
    devtools.record_browser({"webrtc": [{"device_id": "iot-01", "fps": 30}], "ws_rtt_ms": 4.2})
    run_id = client.post("/api/dev/runs/stop").json()["run_id"]

    run = Path(settings.runs_dir) / run_id
    meta = yaml.safe_load((run / "metadata.yaml").read_text())
    assert meta["label"] == "field 1"
    assert meta["ended_at"] is not None
    assert _read(run / "webrtc.csv")[0]["fps"] == "30"
    assert _read(run / "ws.csv")[0]["rtt_ms"] == "4.2"
    assert {p.name for p in run.iterdir()} >= {"windows.csv", "samples.csv", "ping.csv", "robot.csv", "links.csv"}

    runs = client.get("/api/dev/runs").json()
    assert runs[0]["run_id"] == run_id
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
