"""Mission definitions, execution, and losing the robot, through the HTTP API."""

import time

from fastapi.testclient import TestClient

from models.mission import Mission
from tests.conftest import MISSION_ID, Sim

NEW_MISSION = {
    "mission_id": "test-m",
    "name": "Test",
    "map_name": "m",
    "waypoints": [{"waypoint_id": "a", "x": 0, "y": 0}, {"waypoint_id": "b", "x": 5, "y": 0}],
}


def test_mission_crud(client: TestClient):
    assert client.post("/api/missions", json=NEW_MISSION).status_code == 200
    assert client.post("/api/missions", json=NEW_MISSION).status_code == 409  # already exists
    assert client.post("/api/missions", json={**NEW_MISSION, "mission_id": "bad id!"}).status_code == 422
    updated = client.put("/api/missions/test-m", json={**NEW_MISSION, "name": "Renamed"})
    assert updated.status_code == 200 and updated.json()["name"] == "Renamed"
    assert client.put("/api/missions/nope", json={**NEW_MISSION, "mission_id": "nope"}).status_code == 404
    assert client.post("/api/missions/test-m/activate").json()["mission_id"] == "test-m"
    assert client.get("/api/missions/current").json()["mission_id"] == "test-m"
    assert client.delete("/api/missions/test-m").status_code == 204
    assert client.delete("/api/missions/test-m").status_code == 404


def test_save_can_activate_and_fills_in_the_map_name(client: TestClient):
    unnamed = {k: v for k, v in NEW_MISSION.items() if k != "map_name"}
    saved = client.post("/api/missions?activate=true", json=unnamed).json()
    assert saved["map_name"] and client.get("/api/missions/current").json()["mission_id"] == "test-m"

    client.post("/api/missions/mission-2-tdpjxe/activate")
    client.put("/api/missions/test-m?activate=true", json={**unnamed, "name": "Renamed"})
    assert client.get("/api/missions/current").json()["name"] == "Renamed"


def test_execution_lifecycle(sim: Sim):
    client = sim.client
    assert sim.mission_status() == "not_ready"  # no robot yet
    assert client.post("/api/missions/current/start").status_code == 409
    sim.robot(*sim.waypoints[0])
    assert sim.mission_status() == "ready"

    pause = client.post("/api/missions/current/pause")
    assert pause.status_code == 409 and pause.json()["detail"] == "Cannot pause from status ready"

    assert client.post("/api/missions/current/start").json()["status"] == "running"
    current = client.get("/api/missions/current").json()
    assert client.put(f"/api/missions/{MISSION_ID}", json=current).status_code == 409  # locked while running
    assert client.post("/api/missions/current/pause").json()["status"] == "paused"
    assert client.post("/api/missions/current/resume").json()["status"] == "running"

    cancelled = client.post("/api/missions/current/cancel").json()
    assert cancelled["status"] == "ready" and cancelled["target_waypoint_index"] is None
    assert sim.last_command() == ("cancel_navigation", None)  # holds where it is
    assert client.post("/api/missions/current/cancel").status_code == 409
    assert client.post("/api/missions/current/start").json()["status"] == "running"


def test_no_switching_missions_while_one_runs(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.client.post("/api/missions/current/start")
    assert sim.client.post("/api/missions/mission-1-48umx5/activate").status_code == 409
    sim.client.post("/api/missions/current/cancel")
    assert sim.client.post("/api/missions/mission-1-48umx5/activate").status_code == 200


def test_the_mission_is_not_ready_without_the_robot(sim: Sim):
    sim.robot(*sim.waypoints[0])
    assert sim.mission_status() == "ready"
    lose_robot(sim)
    sim.services.mission_service.abort_if_robot_lost(grace_sec=60)  # a monitor tick
    assert sim.mission_status() == "not_ready"
    sim.robot(*sim.waypoints[0])
    assert sim.mission_status() == "ready"


def test_start_joins_at_the_closest_waypoint(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[2])
    started = sim.client.post("/api/missions/current/start").json()
    assert started["target_waypoint_index"] == 2 and started["joining"] is True
    assert sim.goal() == w[2]

    sim.drive_to(*w[2])
    execution = sim.execution()
    assert execution["current_waypoint_index"] == 2 and execution["completed_loops"] == 0
    assert execution["target_waypoint_index"] == 0 and execution["joining"] is False
    sim.drive_to(*w[0])
    assert sim.mission_status() == "ready"  # one loop configured


def test_joining_waypoint_0_finishes_no_loop(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[0])
    sim.client.post("/api/missions/current/start")
    assert sim.goal() == w[0]
    sim.drive_to(*w[0])
    assert sim.execution()["completed_loops"] == 0
    for i in [1, 2, 0]:
        sim.drive_to(*w[i])
    assert sim.mission_status() == "ready"


def test_pausing_keeps_the_target(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[2])
    sim.client.post("/api/missions/current/start")
    sim.client.post("/api/missions/current/pause")
    assert sim.last_command() == ("cancel_navigation", None)
    sim.client.post("/api/missions/current/resume")
    assert sim.goal() == w[2]
    assert sim.execution()["joining"] is True


def test_an_infinite_mission_keeps_looping_until_cancelled(sim: Sim):
    client = sim.client
    w = sim.waypoints
    current = client.get("/api/missions/current").json()
    saved = client.put(f"/api/missions/{MISSION_ID}", json={**current, "infinite_loop": True})
    assert saved.json()["infinite_loop"] is True and saved.json()["loop_count"] == 1  # count kept

    sim.robot(*w[0])
    client.post("/api/missions/current/start")
    sim.drive_to(*w[0])
    for _ in range(3):
        for i in [1, 2, 0]:
            sim.drive_to(*w[i])
    execution = sim.execution()
    assert execution["status"] == "running"
    assert execution["completed_loops"] == 3 and execution["current_loop"] == 4

    summary = next(m for m in client.get("/api/missions").json() if m["mission_id"] == MISSION_ID)
    assert summary["infinite_loop"] is True


def test_a_robot_that_ignores_its_goal_never_reaches_a_waypoint(sim: Sim):
    """A robot that never acted on its goal keeps reporting "arrived" where it
    is parked; only an arrival within 2 m of the waypoint counts."""
    sim.robot(500, 500, "arrived")
    target = sim.client.post("/api/missions/current/start").json()["target_waypoint_index"]
    for _ in range(3):
        sim.robot(500, 500, "arrived")
    execution = sim.execution()
    assert execution["status"] == "running" and execution["target_waypoint_index"] == target
    assert execution["current_waypoint_index"] == 0 and execution["completed_loops"] == 0


def lose_robot(sim: Sim) -> None:
    sim.services.device_registry.mark_offline_devices(1.0, now=time.time() + 10_000)


def test_losing_the_robot_stops_everything_until_the_operator_starts_again(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[0])
    sim.client.post("/api/missions/current/start")
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    lose_robot(sim)

    sim.services.mission_service.abort_if_robot_lost(grace_sec=60)
    assert sim.investigation() is not None  # still within the grace period

    sim.services.mission_service.abort_if_robot_lost(grace_sec=-1)
    assert sim.investigation() is None
    assert sim.mission_status() == "not_ready"
    assert sim.client.get("/api/anomalies/a").json()["resolution"] is None  # no verdict

    sent_before = len(sim.commands)
    sim.robot(*w[0])  # the robot reports in again
    assert sim.commands[sent_before:] == [("cancel_navigation", None)]  # stopped, no new goal
    assert sim.mission_status() == "ready" and sim.investigation() is None
    assert sim.client.post("/api/missions/current/start").json()["status"] == "running"


def test_losing_an_idle_robot_aborts_nothing(sim: Sim):
    sim.robot(*sim.waypoints[0])
    lose_robot(sim)
    assert sim.services.mission_service.abort_autonomy("robot_disconnected") is False


def test_mission_files_from_before_time_slots_were_removed_still_load():
    mission = Mission(mission_id="m", name="n", map_name="x", time_slot=None)
    assert "time_slot" not in mission.model_dump()


def test_the_default_mission_is_gone(client: TestClient):
    assert client.get("/api/missions/default").status_code == 404  # "default" is just an unknown id now
    summary = client.get("/api/missions").json()[0]
    assert "is_default" not in summary and "time_slot" not in summary


def test_mission_list_routes_each_version_once(client: TestClient, services, fake_map, monkeypatch):
    """Listing missions routes a mission's loop only when it changed."""
    calls = []
    route = services.map_server.get_route
    monkeypatch.setattr(services.map_server, "get_route", lambda wps: calls.append(1) or route(wps))
    client.post("/api/missions", json=NEW_MISSION)

    def list_missions():
        assert client.get("/api/missions").status_code == 200

    list_missions()
    routed = len(calls)
    assert routed > 0
    list_missions()
    assert len(calls) == routed  # unchanged: cached

    moved = {**NEW_MISSION, "waypoints": [{"waypoint_id": "a", "x": 0, "y": 0}, {"waypoint_id": "b", "x": 7, "y": 0}]}
    client.put("/api/missions/test-m", json=moved)
    list_missions()
    assert len(calls) == routed + 1  # edited: routed again
