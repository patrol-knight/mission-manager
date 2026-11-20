"""Operator-driven investigate mode through the HTTP API (README "Mission &
Investigation State Machines")."""

import math
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import LANE_YAW, MISSION_ID, Sim


def arrive_on_site(sim: Sim, x: float, y: float) -> None:
    sim.drive_to(x, y)
    assert sim.investigation()["phase"] == "on_site"


def test_needs_a_connected_robot(sim: Sim):
    sim.anomaly("a", 0, 0)
    assert sim.investigate("a").status_code == 409


def test_an_unlocalized_robot_cannot_investigate(sim: Sim):
    sim.robot(None, None)
    sim.anomaly("a", 0, 0)
    assert sim.investigate("a").status_code == 409
    assert sim.commands == []


def test_unknown_anomaly_is_404(sim: Sim):
    sim.robot(*sim.waypoints[0])
    assert sim.investigate("nope").status_code == 404


def test_unreachable_anomaly_is_409_and_sends_nothing(sim: Sim, monkeypatch):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    monkeypatch.setattr(sim.services.map_server, "get_route", lambda points: None)
    assert sim.investigate("a").status_code == 409
    assert sim.investigation() is None and sim.commands == []


def test_full_flow_from_a_ready_robot(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[1])
    sim.anomaly("a", 0, 0)

    started = sim.investigate("a")
    assert started.status_code == 200 and started.json()["phase"] == "en_route"
    assert sim.last_command() == ("navigate_to_goal", {"x": 0.0, "y": 0.0, "frame_id": "map", "yaw": LANE_YAW})
    assert sim.investigate("a").json()["phase"] == "en_route"  # same target again is a no-op

    sim.robot(0.5, 0, "arrived")
    assert sim.investigation()["phase"] == "en_route"  # the goal's result decides, not the state
    sim.goal_result("succeeded")
    assert sim.investigation()["phase"] == "on_site"

    assert sim.finish_investigation().status_code == 409  # Finish needs a verdict
    assert sim.cancel_investigation().status_code == 409  # on site: Finish, not Cancel
    sim.verdict("false_positive")
    assert sim.verdict("true_positive").json()["draft_verdict"] == "true_positive"  # can change its mind
    assert sim.finish_investigation().status_code == 204

    assert sim.investigation() is None
    assert sim.anomaly_record("a")["resolution"] == "true_positive"
    assert sim.feedback == [("a", "true_positive")]
    # Idle mission: the robot holds where it is
    assert sim.mission_status() == "ready"
    assert sim.last_command() == ("cancel_navigation", None)


def test_dispatch_and_arrival_times_are_kept_for_history(sim: Sim):
    sim.robot(*sim.waypoints[1])
    sim.anomaly("a", 0, 0)
    assert sim.anomaly_record("a")["dispatched_at"] is None

    sim.investigate("a")
    dispatched = sim.anomaly_record("a")
    assert dispatched["dispatched_at"] is not None and dispatched["arrived_at"] is None

    sim.robot(0.5, 0, "arrived")
    sim.goal_result("succeeded")
    arrived = sim.anomaly_record("a")
    assert arrived["dispatched_at"] == dispatched["dispatched_at"]
    assert arrived["arrived_at"] >= arrived["dispatched_at"]


def test_the_mission_is_frozen_while_investigating(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    client = sim.client
    assert client.post("/api/missions/current/start").status_code == 409
    assert client.post("/api/missions/mission-1-48umx5/activate").status_code == 409
    current = sim.current()
    assert client.put(f"/api/missions/{MISSION_ID}", json=current).status_code == 409


def test_verdict_only_on_site(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    assert sim.verdict("true_positive").status_code == 409
    assert sim.finish_investigation().status_code == 409  # en route: Cancel, not Finish


def test_switching_on_site_needs_a_verdict_and_commits_it(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.anomaly("b", 10, 0)
    sim.investigate("a")
    arrive_on_site(sim, 0, 0)

    assert sim.investigate("b").status_code == 409
    sim.verdict("unclear")
    switched = sim.investigate("b").json()
    assert switched["anomaly_id"] == "b" and switched["phase"] == "en_route"

    a = sim.anomaly_record("a")
    assert a["resolution"] == "unclear"  # recorded, still on the map
    assert sim.feedback == []  # unclear isn't sent


def test_switching_en_route_abandons_without_a_verdict(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.anomaly("b", 10, 0)
    sim.investigate("a")
    assert sim.investigate("b").json()["anomaly_id"] == "b"
    assert sim.anomaly_record("a")["resolution"] is None


def test_unclear_anomalies_can_be_revisited_but_closed_ones_cannot(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    arrive_on_site(sim, 0, 0)
    sim.verdict("unclear")
    sim.finish_investigation()

    assert sim.investigate("a").status_code == 200
    arrive_on_site(sim, 0, 0)
    sim.verdict("false_positive")
    sim.finish_investigation()
    assert sim.investigate("a").status_code == 409


def test_running_mission_rejoins_at_the_closest_waypoint_without_counting_a_loop(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[0])
    sim.client.post("/api/missions/current/start")
    sim.drive_to(*w[0])
    assert sim.goal() == w[1]

    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    sim.drive_to(*w[1])
    assert sim.execution()["current_waypoint_index"] == 0  # the mission ignores arrivals meanwhile
    arrive_on_site(sim, 0, 0)
    sim.verdict("false_positive")
    sim.finish_investigation()

    assert sim.mission_status() == "running"
    closest = min(range(len(w)), key=lambda i: math.hypot(*w[i]))
    assert sim.goal() == w[closest]
    assert sim.execution()["joining"] is True
    sim.drive_to(*w[closest])
    execution = sim.execution()
    assert execution["current_waypoint_index"] == closest
    assert execution["completed_loops"] == 0 and execution["status"] == "running"


def test_paused_mission_resumes_after_the_investigation(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.client.post("/api/missions/current/start")
    sim.client.post("/api/missions/current/pause")
    sim.anomaly("a", 3, 3)
    sim.investigate("a")
    assert sim.client.post("/api/missions/current/resume").status_code == 409
    assert sim.client.post("/api/missions/current/cancel").status_code == 409

    assert sim.cancel_investigation().status_code == 204  # Cancel en route needs no verdict
    assert sim.anomaly_record("a")["resolution"] is None
    assert sim.mission_status() == "running"


def test_without_a_mission_the_robot_holds_in_place(sim: Sim):
    sim.robot(*sim.waypoints[0])
    assert sim.client.delete(f"/api/missions/{MISSION_ID}").status_code == 204
    sim.anomaly("a", 4, 4)
    sim.investigate("a")
    sim.cancel_investigation()
    assert sim.last_command()[0] == "cancel_navigation"


def test_expiry_skips_the_investigation_target(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("target", 1, 1, degrade_sec=0.01)
    sim.anomaly("other", 2, 2, degrade_sec=0.01)
    sim.investigate("target")
    gone = sim.services.anomaly_registry.expire(now=datetime.now(timezone.utc) + timedelta(hours=1))
    assert gone == ["other"]


def test_websocket_snapshot_includes_the_investigation(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    with sim.client.websocket_connect("/ws") as ws:
        events = [ws.receive_json() for _ in range(7)]
    assert events[-1]["type"] == "investigation.updated"
    assert events[-1]["data"]["anomaly_id"] == "a"


def test_a_failed_goal_ends_the_investigation(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    sim.goal_result("failed", "route_rejected")
    assert sim.investigation() is None
    assert sim.anomaly_record("a")["resolution"] is None


def test_a_dropped_goal_to_the_anomaly_is_sent_again(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    sim.goal_result("failed", "goal_dropped")
    assert [c for c, _ in sim.commands].count("navigate_to_goal") == 2
    assert sim.investigation()["phase"] == "en_route"


# -- Camera unhealthy --------------------------------------------------------------


def test_a_camera_unhealthy_anomaly_is_checked_without_a_verdict(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("cam", 4, 3, types=("camera_unhealthy",))
    state = sim.investigate("cam").json()
    assert state["kind"] == "camera" and state["anomaly_id"] == "cam"

    arrive_on_site(sim, 4, 3)
    assert sim.verdict("true_positive").status_code == 409
    assert sim.finish_investigation().status_code == 204
    assert sim.investigation() is None
    assert sim.anomaly_record("cam")["resolution"] is None  # stays until the camera recovers
    assert sim.feedback == []


def test_a_camera_check_can_be_cancelled_en_route_and_taken_over(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("cam", 4, 3, types=("camera_unhealthy",))
    sim.anomaly("a", 0, 0)
    sim.investigate("cam")
    assert sim.cancel_investigation().status_code == 204

    sim.investigate("cam")
    arrive_on_site(sim, 4, 3)
    assert sim.investigate("a").json()["kind"] == "anomaly"  # nothing to verify, so it can leave
    assert sim.anomaly_record("cam")["resolution"] is None


# -- Go here ----------------------------------------------------------------------


def test_go_here_from_idle_holds_on_site_until_dismissed(sim: Sim):
    sim.robot(*sim.waypoints[0])
    started = sim.go_here(4, 3)
    assert started.status_code == 200
    state = started.json()
    assert state["kind"] == "manual" and state["anomaly_id"] is None and state["phase"] == "en_route"
    assert (state["look_at"]["x"], state["look_at"]["y"]) == (4, 3)
    assert sim.last_command() == ("navigate_to_goal", {"x": 4.0, "y": 3.0, "frame_id": "map", "yaw": LANE_YAW})

    sim.drive_to(4, 3)
    assert sim.investigation()["phase"] == "on_site"
    assert sim.verdict("true_positive").status_code == 409  # nothing to verify

    assert sim.finish_investigation().status_code == 204  # Dismiss needs no verdict
    assert sim.investigation() is None
    assert sim.last_command() == ("cancel_navigation", None)  # no mission: holds


def test_go_here_can_be_cancelled_en_route(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.go_here(4, 3)
    assert sim.cancel_investigation().status_code == 204
    assert sim.investigation() is None


def test_go_here_freezes_a_running_mission_and_hands_it_back(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[0])
    sim.client.post("/api/missions/current/start")
    sim.drive_to(*w[0])

    sim.go_here(4, 3)
    assert sim.client.post("/api/missions/current/pause").status_code == 409
    sim.drive_to(4, 3)
    assert sim.execution()["current_waypoint_index"] == 0  # the arrival was Go here's

    sim.finish_investigation()
    assert sim.mission_status() == "running"
    assert sim.last_command()[0] == "navigate_to_goal" and sim.goal() in w


def test_go_here_retargets_and_ignores_the_old_goal(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.go_here(4, 3)
    old_request = sim.request_ids[-1]
    assert sim.go_here(8, 1).json()["phase"] == "en_route"
    assert sim.goal() == (8, 1)

    sim.goal_result("succeeded", request_id=old_request)
    assert sim.investigation()["phase"] == "en_route"
    sim.drive_to(8, 1)
    on_site = sim.investigation()
    assert on_site["phase"] == "on_site"
    assert sim.go_here(4, 3).json()["phase"] == "en_route"  # on site too


def test_go_here_takes_over_an_anomaly_en_route_without_a_verdict(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    assert sim.go_here(4, 3).json()["kind"] == "manual"
    assert sim.anomaly_record("a")["resolution"] is None


def test_go_here_takes_over_an_anomaly_on_site_without_a_verdict(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    arrive_on_site(sim, 0, 0)
    assert sim.go_here(4, 3).status_code == 200  # no VerdictRequired: an explicit order
    assert sim.anomaly_record("a")["resolution"] is None and sim.feedback == []


def test_go_here_commits_the_draft_verdict_of_the_anomaly_it_leaves(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    arrive_on_site(sim, 0, 0)
    sim.verdict("true_positive")
    sim.go_here(4, 3)
    assert sim.anomaly_record("a")["resolution"] == "true_positive"
    assert sim.feedback == [("a", "true_positive")]


def test_an_anomaly_takes_over_from_go_here(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.go_here(4, 3)
    sim.drive_to(4, 3)
    sim.anomaly("a", 0, 0)
    started = sim.investigate("a").json()
    assert started["kind"] == "anomaly" and started["anomaly_id"] == "a"


def test_go_here_preview_sends_nothing(sim: Sim, settings):
    settings.patrol_speed_mps = 0.5
    settings.waypoint_stop_sec = 5
    sim.robot(*sim.waypoints[0])
    preview = sim.preview_go_here(4, 3)
    assert preview.status_code == 200
    assert preview.json()["eta_sec"] == pytest.approx(preview.json()["length_m"] / 0.5 + 5)
    assert (preview.json()["target"]["x"], preview.json()["target"]["y"]) == (4, 3)
    assert sim.commands == [] and sim.investigation() is None


def test_go_here_needs_a_robot_and_a_reachable_point(sim: Sim, monkeypatch):
    assert sim.go_here(4, 3).status_code == 409
    sim.robot(*sim.waypoints[0])
    monkeypatch.setattr(sim.services.map_server, "get_route", lambda points: None)
    assert sim.go_here(4, 3).status_code == 409
    assert sim.preview_go_here(4, 3).status_code == 409
    assert sim.commands == []


def test_go_here_where_the_robot_already_is_starts_on_site(sim: Sim):
    sim.robot(4, 3)
    state = sim.go_here(4, 3).json()
    assert state["phase"] == "on_site" and state["arrived_at"] is not None
    assert sim.last_command() == ("cancel_navigation", None)


def test_losing_the_robot_aborts_go_here(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.go_here(4, 3)
    assert sim.services.mission_service.abort_autonomy("robot_disconnected") is True
    assert sim.investigation() is None


# -- Blocked close to the goal -----------------------------------------------------


@pytest.fixture
def clock(sim: Sim, monkeypatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr(sim.services.investigation, "_clock", lambda: now[0])
    return now


def test_blocked_close_to_the_goal_long_enough_counts_as_arrived(sim: Sim, clock: list[float]):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    sim.goal_result("running")

    sim.robot(3, 0, "blocked", "auto")  # 3 m short
    clock[0] += 4.9
    sim.robot(3, 0, "blocked", "auto")
    assert sim.investigation()["phase"] == "en_route"

    clock[0] += 0.2
    sim.robot(3, 0, "blocked", "auto")
    assert sim.investigation()["phase"] == "on_site"
    assert sim.anomaly_record("a")["arrived_at"] is not None
    assert sim.last_command() == ("cancel_navigation", None)

    # The cancelled goal's result is the old goal's: it changes nothing.
    sim.goal_result("failed", code="cancelled")
    assert sim.investigation()["phase"] == "on_site"


def test_blocked_far_from_the_goal_or_moving_again_is_not_arrival(sim: Sim, clock: list[float]):
    sim.robot(*sim.waypoints[0])
    sim.go_here(0, 0)
    sim.robot(5, 0, "blocked", "auto")  # beyond 4 m
    clock[0] += 10
    sim.robot(5, 0, "blocked", "auto")
    assert sim.investigation()["phase"] == "en_route"

    sim.robot(3, 0, "blocked", "auto")
    clock[0] += 3
    sim.robot(3, 0, "navigating", "auto")  # cleared: the window restarts
    clock[0] += 3
    sim.robot(3, 0, "blocked", "auto")
    clock[0] += 3
    sim.robot(3, 0, "blocked", "auto")
    assert sim.investigation()["phase"] == "en_route"
