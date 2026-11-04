"""Shared fixtures: an app on a throwaway copy of storage/, a straight-line
map instead of lanelet2 routing (deterministic, no map files needed), a fake
robot and anomaly source fed through the real Zenoh ingest path, and a record
of every command the backend would have sent over Zenoh."""

import math
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import create_app
from bootstrap import Services
from config import Settings
from models.map import LatLon, MapPoint

# Two KS-map missions, kept here so the tests never depend on (or touch)
# the missions saved in storage/.
FIXTURE_MISSIONS = Path(__file__).resolve().parent / "fixtures" / "missions"
MISSION_ID = "mission-2-tdpjxe"  # the tests' current mission (3 waypoints, 1 loop)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    shutil.copytree(FIXTURE_MISSIONS, tmp_path / "missions")
    # Not a copy of the live app_state.yaml: a running backend changes it.
    (tmp_path / "app_state.yaml").write_text(f"current_mission_id: {MISSION_ID}\n")
    return Settings(
        _env_file=None,
        mission_folder=str(tmp_path / "missions"),
        app_state_path=str(tmp_path / "app_state.yaml"),
        map_osm_path=str(tmp_path / "no-map.osm"),  # MapServer stays unavailable unless faked
        zenoh_enabled=False,
        database_url=None,
        device_monitor_interval_sec=3600,  # tests drive the monitor's checks themselves
    )


@pytest.fixture
def client(settings: Settings):
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def services(client: TestClient) -> Services:
    return client.app.state.services


def _straight_route(points: list[dict]) -> dict:
    a, b = points[0], points[-1]
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": []},
        "properties": {"length_m": math.hypot(a["x"] - b["x"], a["y"] - b["y"])},
    }


LANE_YAW = 0.5  # every lane of the fake map runs this way


@pytest.fixture
def fake_map(services: Services, monkeypatch: pytest.MonkeyPatch) -> None:
    """Straight lines instead of lanelet2: every point is on the network and
    route length is Euclidean distance."""
    m = services.map_server
    monkeypatch.setattr(m, "is_available", lambda: True)
    monkeypatch.setattr(
        m, "snap_to_lanelet", lambda x, y, frame_id="map": MapPoint(x=x, y=y, frame_id=frame_id, lat=1.0, lon=2.0)
    )
    monkeypatch.setattr(m, "xy_to_latlon", lambda x, y, frame_id="map": LatLon(lat=1.0, lon=2.0))
    monkeypatch.setattr(m, "get_route", _straight_route)
    monkeypatch.setattr(m, "lane_yaw", lambda x, y: LANE_YAW)


@dataclass
class Sim:
    """A fake robot and anomaly source, plus what the backend sent back."""

    client: TestClient
    services: Services
    commands: list[tuple[str, dict | None]] = field(default_factory=list)
    request_ids: list[str] = field(default_factory=list)
    feedback: list[tuple[str, str]] = field(default_factory=list)
    _clock: float = 100.0

    @property
    def waypoints(self) -> list[tuple[float, float]]:
        return [(w["x"], w["y"]) for w in self.client.get("/api/missions/current").json()["waypoints"]]

    def robot(self, x: float | None, y: float | None, state: str = "ready", mode: str | None = None) -> None:
        """One state sample from the robot; each one is newer than the last.
        x/y None: not localized, sent as pose null like zenoh_bridge does."""
        self._clock += 1
        self.services.zenoh_gateway.ingest_device_payload(
            {
                "device_id": "robot-1",
                "type": "robot",
                "pose": {"x": x, "y": y} if x is not None and y is not None else None,
                "timestamp": self._clock,
                "status": {"state": state, "mode": mode},
            }
        )

    def drive_to(self, x: float, y: float) -> None:
        """Drive to (x, y) and finish the last goal."""
        self.goal_result("running")
        self.robot(x + 50, y + 50, "navigating", "auto")
        self.robot(x, y, "arrived")
        self.goal_result("succeeded")

    def goal_result(self, status: str, code: str | None = None, request_id: str | None = None) -> None:
        """A CommandResult for the last navigate_to_goal, as zenoh_bridge sends it."""
        if request_id is None:
            sent = zip(self.commands, self.request_ids, strict=True)
            request_id = [r for (c, _), r in sent if c == "navigate_to_goal"][-1]
        self.services.zenoh_gateway.ingest_command_result_payload(
            {
                "request_id": request_id,
                "device_id": "robot-1",
                "command": "navigate_to_goal",
                "status": status,
                "message": code,
                "code": code,
                "timestamp": "2026-11-04T00:00:00Z",
            }
        )

    def anomaly(self, anomaly_id: str, x: float, y: float, degrade_sec: float = 30) -> None:
        now = time.time()
        self.services.zenoh_gateway.ingest_anomaly_payload(
            {
                "anomaly_id": anomaly_id,
                "types": ["lying_down"],
                "x": x,
                "y": y,
                "confidence": 0.9,
                "source_device_id": "iot-01",
                "detected_at": now,
                "updated_at": now,
                "degrade_sec": degrade_sec,
            }
        )

    # -- reading state back -------------------------------------------------

    def mission_status(self) -> str:
        return self.client.get("/api/missions/current/execution").json()["status"]

    def execution(self) -> dict:
        return self.client.get("/api/missions/current/execution").json()

    def investigation(self) -> dict | None:
        return self.client.get("/api/investigation").json()

    def last_command(self) -> tuple[str, dict | None]:
        return self.commands[-1]

    # -- operator actions ---------------------------------------------------

    def investigate(self, anomaly_id: str):
        return self.client.post("/api/investigation", json={"anomaly_id": anomaly_id})

    def verdict(self, verdict: str):
        return self.client.put("/api/investigation/verdict", json={"verdict": verdict})

    def cancel_investigation(self):
        return self.client.post("/api/investigation/cancel")

    def finish_investigation(self):
        return self.client.post("/api/investigation/finish")

    def goal(self) -> tuple[float, float]:
        fields = next(f for c, f in reversed(self.commands) if c == "navigate_to_goal")
        return fields["x"], fields["y"]


@pytest.fixture
def sim(client: TestClient, services: Services, fake_map: None, monkeypatch: pytest.MonkeyPatch) -> Sim:
    s = Sim(client, services)
    gateway = services.zenoh_gateway

    def publish_command(device_id, command, request_id, fields=None):
        s.commands.append((command, fields))
        s.request_ids.append(request_id)
        return True

    monkeypatch.setattr(gateway, "publish_command", publish_command)
    monkeypatch.setattr(
        gateway,
        "publish_anomaly_feedback",
        lambda anomaly_id, resolution, resolved_at: s.feedback.append((anomaly_id, resolution)) or True,
    )
    return s
