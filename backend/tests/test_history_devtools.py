"""/dev History tab. The Postgres tests run when TEST_DATABASE_URL is set."""

import csv
import io
import os
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import create_app
from config import Settings

STORAGE = Path(__file__).resolve().parent.parent / "storage"
DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
needs_postgres = pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL not set")

SCENARIO = """
name: Test site
days: 3
hours_per_day: 4
seed: 7
devices:
  - id: iot-01
    at: [0, 0]
    offline_days_ago: [1]
  - id: robot-1
    type: robot
hotspots:
  - name: Gate
    at: [0, 0]
    rate_per_hour: 5
    true_share: 0.5
background:
  rate_per_hour: 1
  device: robot-1
"""


def test_without_a_database_reads_are_503_and_writes_403(client: TestClient):
    status = client.get("/api/dev/history/status").json()
    assert status["database"] == {"configured": False}
    assert status["write_enabled"] is False
    assert client.get("/api/dev/history/sessions").status_code == 503
    assert client.post("/api/dev/history/seed", json={}).status_code == 403
    assert client.post("/api/dev/history/purge", json={"older_than_days": 1}).status_code == 403
    assert client.delete("/api/dev/history/sessions/00000000-0000-0000-0000-000000000000").status_code == 403


class LineMap:
    """A 100 m lane along x, 1 m = 1e-5 degrees."""

    def __init__(self):
        from core.history_synth import LaneMap

        self.lane_map = LaneMap("line", "abc", [[(0.0, 0.0), (100.0, 0.0)]], lambda x, y: (y * 1e-5, x * 1e-5))


def test_seed_spreads_sessions_on_the_lanes():
    synth = pytest.importorskip("core.history_synth")
    generated = synth.seed(LineMap().lane_map, "sim", sessions=4, anomalies_per_session=30, days=10, hotspots=2,
                           hotspot_share=0.5, seed=1)
    assert len(generated) == 4
    for session, anomalies, uptime in generated:
        assert session["map_name"] == "line" and session["source"] == "sim" and uptime == []
        assert len(anomalies) == 30
        assert all(-10 < a["x"] < 110 and abs(a["y"]) < 15 for a in anomalies)


def test_scenario_runs_one_session_per_day_and_respects_outages():
    synth = pytest.importorskip("core.history_synth")
    scenario = synth.Scenario.from_yaml(SCENARIO)
    now = datetime(2026, 1, 10, 12, tzinfo=timezone.utc)
    generated = scenario.generate(LineMap().lane_map, now=now)
    assert [s["started_at"].day for s, _, _ in generated] == [7, 8, 9]
    last_session, last_anomalies, last_uptime = generated[-1]
    # iot-01 was down on the last day: only the robot saw anything, and only it was up.
    assert {a["source_device_id"] for a in last_anomalies} <= {"robot-1"}
    assert [u["device_id"] for u in last_uptime] == ["robot-1"]
    first_anomalies = generated[0][1]
    assert any(a["source_device_id"] == "iot-01" for a in first_anomalies)
    for _, anomalies, _ in generated:
        for a in anomalies:
            assert a["closed_at"] >= a["detected_at"]
            if a["arrived_at"]:
                assert a["detected_at"] <= a["dispatched_at"] <= a["arrived_at"]


@pytest.mark.parametrize(
    "text",
    ["- a list", "devices: []", "source: other\ndevices: [{id: a, at: [0, 0]}]", "devices: [{id: a}]",
     "devices: [{id: a, at: [0, 0]}]\nhotspots: [{name: x, at: [0, 0], rate_per_hour: 1, device: nope}]"],
)
def test_invalid_scenarios_are_rejected(text):
    synth = pytest.importorskip("core.history_synth")
    with pytest.raises(ValueError):
        synth.Scenario.from_yaml(text)


@pytest.fixture
def db_client(settings: Settings, tmp_path: Path):
    pytest.importorskip("lanelet2")
    pytest.importorskip("heatmap_estimator")
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS device_uptime, anomaly_history, sessions, schema_version")
    scenarios = tmp_path / "scenarios"
    scenarios.mkdir()
    (scenarios / "test.yaml").write_text(SCENARIO)
    settings = settings.model_copy(update={
        "database_url": DATABASE_URL,
        "devtools_history_write": True,
        "history_scenarios_dir": str(scenarios),
        "map_osm_path": str(STORAGE / "maps" / "ks" / "lanelet2_map.osm"),
        "map_projector_path": str(STORAGE / "maps" / "ks" / "map_projector_info.yaml"),
    })
    with TestClient(create_app(settings)) as client:
        yield client


@needs_postgres
def test_history_round_trip(db_client: TestClient):
    api = "/api/dev/history"
    status = db_client.get(f"{api}/status").json()
    assert status["database"]["schema_ready"] and status["map_name"] == "ks"
    assert db_client.get(f"{api}/scenarios").json()[0]["file"] == "test.yaml"

    loaded = db_client.post(f"{api}/scenario", json={"yaml": SCENARIO}).json()
    assert loaded["sessions"] == 3 and loaded["anomalies"] > 0
    seeded = db_client.post(f"{api}/seed", json={"sessions": 2, "anomalies_per_session": 10, "seed": 3}).json()
    assert seeded == {"sessions": 2, "anomalies": 20}

    sessions = db_client.get(f"{api}/sessions").json()
    # The 5 generated plus this run's own session.
    assert len(sessions) == 6
    assert any(s["id"] == status["current_session_id"] for s in sessions)
    scripted = [s for s in sessions if s["label"] == "Test site"]
    assert sum(s["total"] for s in scripted) == loaded["anomalies"]

    heat = db_client.get(f"{api}/heatmap").json()
    assert heat["grid"]["width"] > 0 and len(heat["grid"]["corners"]) == 4
    assert heat["stats"]["records"] == loaded["anomalies"] + 20
    assert db_client.get(f"{api}/heatmap", params={"model": "density"}).json()["grid"] is not None

    devices = {d["device_id"]: d for d in db_client.get(f"{api}/devices").json()["devices"]}
    assert devices["iot-01"]["online_hours"] == pytest.approx(8.0)  # 2 of 3 days, 4 h each

    target = scripted[0]
    assert db_client.patch(f"{api}/sessions/{target['id']}", json={"excluded": True, "label": "x"}).status_code == 204
    after = db_client.get(f"{api}/heatmap").json()["stats"]["records"]
    assert after == heat["stats"]["records"] - target["total"]

    rows = list(csv.reader(io.StringIO(db_client.get(f"{api}/export.csv", params={"session_id": target["id"]}).text)))
    assert len(rows) == target["total"] + 1 and rows[0][0] == "anomaly_id"

    assert db_client.delete(f"{api}/sessions/{target['id']}").status_code == 204
    assert db_client.delete(f"{api}/sessions/{target['id']}").status_code == 404
    purged = db_client.post(f"{api}/purge", json={"source": "sim", "older_than_days": 0}).json()
    assert purged["anomalies"] > 0
    assert db_client.post(f"{api}/scenario", json={"yaml": "devices: []"}).status_code == 422
