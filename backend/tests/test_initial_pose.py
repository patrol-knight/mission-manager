import asyncio

import pytest

from api import devtools
from models.map import XY
from tests.conftest import Sim

POSE = {"lat": 1.0, "lon": 2.0, "yaw": 1.5}


@pytest.fixture(autouse=True)
def projected(sim: Sim, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sim.services.map_server, "latlon_to_xy", lambda lat, lon: XY(x=12.0, y=-3.0, frame_id="map"))


def bridge_replies(sim: Sim, monkeypatch: pytest.MonkeyPatch, status: str, message: str = "") -> None:
    sent = sim.services.zenoh_gateway.publish_command

    def publish_command(device_id, command, request_id, fields=None):
        sent(device_id, command, request_id, fields)
        sim.services.zenoh_gateway.ingest_command_result_payload(
            {
                "request_id": request_id,
                "device_id": device_id,
                "command": command,
                "status": status,
                "message": message,
                "timestamp": "2026-01-01T00:00:00Z",
            }
        )
        return True

    monkeypatch.setattr(sim.services.zenoh_gateway, "publish_command", publish_command)


def test_sends_the_pose_in_the_map_frame(sim: Sim, monkeypatch: pytest.MonkeyPatch) -> None:
    sim.robot(None, None, "notready")
    bridge_replies(sim, monkeypatch, "succeeded")
    assert sim.client.post("/api/dev/initial-pose", json=POSE).status_code == 204
    assert sim.last_command() == ("set_initial_pose", {"x": 12.0, "y": -3.0, "yaw": 1.5, "frame_id": "map"})


def test_shows_why_the_bridge_refused(sim: Sim, monkeypatch: pytest.MonkeyPatch) -> None:
    sim.robot(None, None, "notready")
    bridge_replies(sim, monkeypatch, "rejected", "unknown command: set_initial_pose")
    response = sim.client.post("/api/dev/initial-pose", json=POSE)
    assert response.status_code == 503
    assert response.json()["detail"] == "zenoh_bridge rejected: unknown command: set_initial_pose"


def test_a_silent_bridge_is_an_error(sim: Sim, monkeypatch: pytest.MonkeyPatch) -> None:
    sim.robot(None, None, "notready")
    monkeypatch.setattr(devtools, "INITIAL_POSE_REPLY_TIMEOUT_SEC", 0.01)
    response = sim.client.post("/api/dev/initial-pose", json=POSE)
    assert response.status_code == 503
    assert response.json()["detail"] == "No reply from the robot's zenoh_bridge"


def test_needs_a_connected_robot(sim: Sim) -> None:
    assert sim.client.post("/api/dev/initial-pose", json=POSE).status_code == 409


def test_unreachable_robot(sim: Sim, monkeypatch: pytest.MonkeyPatch) -> None:
    sim.robot(None, None, "notready")
    monkeypatch.setattr(sim.services.zenoh_gateway, "publish_command", lambda *a, **k: False)
    assert sim.client.post("/api/dev/initial-pose", json=POSE).status_code == 503


def test_an_unlocalized_robot_does_not_break_the_devtools_tick(sim: Sim) -> None:
    sim.robot(None, None, "notready")
    sim.client.post("/api/dev/runs", json={})
    asyncio.run(sim.services.devtools._tick())
    sim.client.post("/api/dev/runs/stop")
