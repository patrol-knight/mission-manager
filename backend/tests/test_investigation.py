"""Operator-driven investigate mode through the HTTP API (README "Mission &
Investigation State Machines")."""

import math
from datetime import datetime, timedelta, timezone

from tests.conftest import MISSION_ID, Sim


def arrive_on_site(sim: Sim, x: float, y: float) -> None:
    sim.drive_to(x, y)
    assert sim.investigation()["phase"] == "on_site"


def test_needs_a_connected_robot(sim: Sim):
    sim.anomaly("a", 0, 0)
    assert sim.investigate("a").status_code == 409


def test_unknown_anomaly_is_404(sim: Sim):
    sim.robot(*sim.waypoints[0])
    assert sim.investigate("nope").status_code == 404


def test_unreachable_anomaly_is_409_and_sends_nothing(sim: Sim, monkeypatch):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    monkeypatch.setattr(sim.services.map_server, "get_route", lambda points: None)
    assert sim.investigate("a").status_code == 409
    assert sim.investigation() is None and sim.commands == []


def test_full_flow_from_an_idle_robot(sim: Sim):
    w = sim.waypoints
    sim.robot(*w[1])
    sim.anomaly("a", 0, 0)

    started = sim.investigate("a")
    assert started.status_code == 200 and started.json()["phase"] == "en_route"
    assert sim.last_command() == ("navigate_to_goal", {"x": 0.0, "y": 0.0, "frame_id": "map"})
    assert sim.investigate("a").json()["phase"] == "en_route"  # same target again is a no-op

    sim.robot(50, 50, "arrived")
    assert sim.investigation()["phase"] == "en_route"  # "arrived" far from the target doesn't count
    sim.robot(0.5, 0, "arrived")
    assert sim.investigation()["phase"] == "on_site"

    assert sim.finish_investigation().status_code == 409  # Finish needs a verdict
    assert sim.cancel_investigation().status_code == 409  # on site: Finish, not Cancel
    sim.verdict("false_positive")
    assert sim.verdict("true_positive").json()["draft_verdict"] == "true_positive"  # can change its mind
    assert sim.finish_investigation().status_code == 204

    assert sim.investigation() is None
    assert sim.client.get("/api/anomalies/a").json()["resolution"] == "true_positive"
    assert sim.feedback == [("a", "true_positive")]
    # Idle mission: the robot holds where it is
    assert sim.mission_status() == "ready"
    assert sim.last_command() == ("cancel_navigation", None)


def test_the_mission_is_frozen_while_investigating(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.investigate("a")
    client = sim.client
    assert client.post("/api/missions/current/start").status_code == 409
    assert client.post("/api/missions/mission-1-48umx5/activate").status_code == 409
    current = client.get("/api/missions/current").json()
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

    a = sim.client.get("/api/anomalies/a").json()
    assert a["resolution"] == "unclear"  # recorded, still on the map
    assert sim.feedback == []  # unclear isn't sent


def test_switching_en_route_abandons_without_a_verdict(sim: Sim):
    sim.robot(*sim.waypoints[0])
    sim.anomaly("a", 0, 0)
    sim.anomaly("b", 10, 0)
    sim.investigate("a")
    assert sim.investigate("b").json()["anomaly_id"] == "b"
    assert sim.client.get("/api/anomalies/a").json()["resolution"] is None


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
    assert sim.client.get("/api/anomalies/a").json()["resolution"] is None
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
