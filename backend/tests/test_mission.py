"""Mission definitions, execution, and losing the robot, through the HTTP API."""

import time

import pytest
from fastapi.testclient import TestClient

from models.mission import Mission
from tests.conftest import LANE_YAW, MISSION_ID, Sim

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


def test_a_goal_that_times_out_is_sent_again(sim: Sim, settings):
    settings.navigation_timeout_sec = 0.05
    w = sim.waypoints
    sim.robot(*w[2])
    sim.client.post("/api/missions/current/start")

    def goals():
        return [f for c, f in sim.commands if c == "navigate_to_goal"]

    deadline = time.monotonic() + 3
    while len(goals()) < 2 and time.monotonic() < deadline:
        time.sleep(0.02)
    assert len(goals()) >= 2
    assert all((g["x"], g["y"]) == w[2] for g in goals())  # same target, still joining
    assert sim.execution()["joining"] is True


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
    sim.services.mission_service.abort_if_robot_lost(grace_sec=-1)
    assert sim.commands == []  # nothing to cancel
    assert sim.mission_status() == "not_ready"


@pytest.mark.parametrize("state", ["notready", "failure", "manual"])
def test_the_mission_cannot_start_while_the_robot_cannot_drive(sim: Sim, state: str):
    sim.robot(*sim.waypoints[0], state)
    assert sim.mission_status() == "not_ready"
    assert sim.client.post("/api/missions/current/start").status_code == 409
    sim.robot(*sim.waypoints[0], "idle")
    assert sim.mission_status() == "ready"


@pytest.mark.parametrize(("state", "cancels"), [("failure", False), ("manual", False), ("notready", True)])
def test_a_robot_that_cannot_drive_stops_a_running_mission(sim: Sim, state: str, cancels: bool):
    sim.robot(*sim.waypoints[0])
    sim.client.post("/api/missions/current/start")
    sent_before = len(sim.commands)

    sim.robot(*sim.waypoints[0], state)
    sim.services.mission_service.abort_if_robot_unavailable()
    assert sim.mission_status() == "not_ready"
    assert (sim.commands[sent_before:] == [("cancel_navigation", None)]) is cancels


def test_a_paused_mission_waits_for_the_robot_to_resume(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.client.post("/api/missions/current/start")
    sim.client.post("/api/missions/current/pause")

    sim.robot(*sim.waypoints[0], "manual")
    sim.services.mission_service.abort_if_robot_unavailable()
    assert sim.mission_status() == "paused"
    assert sim.client.post("/api/missions/current/resume").status_code == 409

    sim.robot(*sim.waypoints[0], "idle")
    assert sim.client.post("/api/missions/current/resume").json()["status"] == "running"


def test_mission_files_from_before_time_slots_were_removed_still_load():
    mission = Mission(mission_id="m", name="n", map_name="x", time_slot=None)
    assert "time_slot" not in mission.model_dump()


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


def test_only_missions_made_on_the_loaded_map_are_loaded(tmp_path):
    """Switching maps hides the other map's missions without deleting them."""
    from core.errors import MissionAlreadyExistsError
    from core.mission_server import MissionServer

    folder = tmp_path / "missions"
    folder.mkdir()
    for mission_id, map_name in (("on-ks", "ks"), ("on-nsh", "nsh")):
        (folder / f"{mission_id}.yaml").write_text(f"mission_id: {mission_id}\nname: n\nmap_name: {map_name}\n")
    (tmp_path / "app_state.yaml").write_text("current_mission_id: on-ks\n")

    nsh = MissionServer(str(folder), str(tmp_path / "app_state.yaml"), "nsh")
    nsh.load()
    assert [m.mission_id for m in nsh.list_missions()] == ["on-nsh"]
    assert nsh.get_current() is None  # the KS mission was current
    assert (folder / "on-ks.yaml").exists()
    with pytest.raises(MissionAlreadyExistsError):  # a hidden mission's id is still taken
        nsh.create_mission(Mission(mission_id="on-ks", name="n", map_name="nsh"))


def test_saving_heads_every_waypoint_along_its_lane_and_goals_use_it(sim: Sim):
    current = sim.client.get("/api/missions/current").json()
    assert all(wp["yaw"] is None for wp in current["waypoints"])  # fixture saved without a map
    saved = sim.client.put(f"/api/missions/{MISSION_ID}", json=current).json()
    assert all(wp["yaw"] == LANE_YAW for wp in saved["waypoints"])

    w = sim.waypoints
    sim.robot(*w[0])
    sim.client.post("/api/missions/current/start")
    sim.drive_to(*w[0])
    goals = [f for c, f in sim.commands if c == "navigate_to_goal"]
    assert goals and all(g["yaw"] == LANE_YAW for g in goals)


def test_an_unlocalized_robot_has_no_pose(sim: Sim):
    sim.robot(None, None, "notready")
    robot = sim.client.get("/api/devices/robot-1").json()
    assert robot["pose"] is None and robot["status"]["operational_state"] == "notready"
    assert sim.client.post("/api/missions/current/start").status_code == 409


@pytest.mark.parametrize("state", ["", "charging"])
def test_a_robot_without_a_known_state_is_not_ready(sim: Sim, state: str):
    sim.robot(*sim.waypoints[0], state)
    assert sim.mission_status() == "not_ready"
    assert sim.client.post("/api/missions/current/start").status_code == 409
