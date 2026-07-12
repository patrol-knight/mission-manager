import time

import pytest
import yaml

from core.errors import (
    MissionAlreadyExistsError,
    MissionNotFoundError,
    MissionValidationError,
)
from core.mission_server import MissionServer
from models.mission import Mission, TimeSlot
from models.waypoint import Waypoint


def make_mission(mission_id="m1", **overrides) -> Mission:
    defaults = dict(
        mission_id=mission_id,
        name="Mission One",
        map_name="warehouse_main",
        waypoints=[Waypoint(waypoint_id="wp_001", x=1.0, y=2.0)],
    )
    defaults.update(overrides)
    return Mission(**defaults)


def test_empty_load(mission_server: MissionServer):
    assert mission_server.list_missions() == []
    assert mission_server.get_current() is None
    assert mission_server.get_default() is None


def test_loading_valid_yaml(tmp_path):
    missions_dir = tmp_path / "missions"
    missions_dir.mkdir()
    data = make_mission("loaded_one").model_dump(mode="json")
    with open(missions_dir / "loaded_one.yaml", "w") as f:
        yaml.safe_dump(data, f)

    server = MissionServer(str(missions_dir), str(tmp_path / "app_state.yaml"))
    server.load()

    mission = server.get_mission("loaded_one")
    assert mission is not None
    assert mission.name == "Mission One"


def test_duplicate_mission_creation(mission_server: MissionServer):
    mission_server.create_mission(make_mission("dup"))
    with pytest.raises(MissionAlreadyExistsError):
        mission_server.create_mission(make_mission("dup"))


def test_create_persists_yaml(mission_server: MissionServer):
    mission_server.create_mission(make_mission("persisted"))
    path = mission_server._mission_path("persisted")
    assert path.exists()
    with open(path) as f:
        raw = yaml.safe_load(f)
    assert raw["mission_id"] == "persisted"


def test_update_preserves_created_at_changes_updated_at(mission_server: MissionServer):
    created = mission_server.create_mission(make_mission("u1"))
    time.sleep(0.01)
    updated = mission_server.update_mission("u1", make_mission("u1", name="Renamed"))

    assert updated.created_at == created.created_at
    assert updated.updated_at > created.updated_at
    assert updated.name == "Renamed"


def test_update_unknown_id_raises(mission_server: MissionServer):
    with pytest.raises(MissionNotFoundError):
        mission_server.update_mission("missing", make_mission("missing"))


def test_update_rejects_conflicting_body_id(mission_server: MissionServer):
    mission_server.create_mission(make_mission("path_id"))
    with pytest.raises(MissionValidationError):
        mission_server.update_mission("path_id", make_mission("other_id"))


def test_delete_removes_file(mission_server: MissionServer):
    mission_server.create_mission(make_mission("del1"))
    path = mission_server._mission_path("del1")
    assert path.exists()

    mission_server.delete_mission("del1")
    assert not path.exists()
    assert mission_server.get_mission("del1") is None


def test_delete_unknown_id_raises(mission_server: MissionServer):
    with pytest.raises(MissionNotFoundError):
        mission_server.delete_mission("missing")


def test_delete_clears_current_and_default(mission_server: MissionServer):
    mission_server.create_mission(make_mission("c1"))
    mission_server.activate("c1")
    mission_server.set_default("c1")

    mission_server.delete_mission("c1")

    assert mission_server.get_current() is None
    assert mission_server.get_default() is None
    with open(mission_server._app_state_path) as f:
        state = yaml.safe_load(f)
    assert state["current_mission_id"] is None
    assert state["default_mission_id"] is None


def test_activate_persists_state(mission_server: MissionServer):
    mission_server.create_mission(make_mission("act1"))
    mission_server.activate("act1")

    with open(mission_server._app_state_path) as f:
        state = yaml.safe_load(f)
    assert state["current_mission_id"] == "act1"


def test_activate_unknown_id_raises(mission_server: MissionServer):
    with pytest.raises(MissionNotFoundError):
        mission_server.activate("missing")


def test_set_default_persists_state(mission_server: MissionServer):
    mission_server.create_mission(make_mission("def1"))
    mission_server.set_default("def1")

    with open(mission_server._app_state_path) as f:
        state = yaml.safe_load(f)
    assert state["default_mission_id"] == "def1"


def test_summary_excludes_waypoints_and_reports_count(mission_server: MissionServer):
    mission_server.create_mission(
        make_mission(
            "sum1",
            waypoints=[
                Waypoint(waypoint_id="wp_001", x=0, y=0),
                Waypoint(waypoint_id="wp_002", x=1, y=1),
            ],
        )
    )
    summaries = mission_server.list_missions()
    assert len(summaries) == 1
    summary = summaries[0]
    assert summary.waypoint_count == 2
    assert not hasattr(summary, "waypoints")


def test_duplicate_waypoint_ids_rejected():
    with pytest.raises(Exception):
        make_mission(
            "bad",
            waypoints=[
                Waypoint(waypoint_id="wp_dup", x=0, y=0),
                Waypoint(waypoint_id="wp_dup", x=1, y=1),
            ],
        )


def test_overnight_time_slot_resolution(mission_server: MissionServer):
    mission_server.create_mission(
        make_mission(
            "night",
            name="Night Patrol",
            time_slot=TimeSlot(start="22:00", end="06:00"),
        )
    )
    mission_server.create_mission(
        make_mission(
            "day",
            name="Day Patrol",
            time_slot=TimeSlot(start="08:00", end="18:00"),
        )
    )

    assert mission_server.resolve_by_time("23:30").mission_id == "night"
    assert mission_server.resolve_by_time("02:00").mission_id == "night"
    assert mission_server.resolve_by_time("12:00").mission_id == "day"
    assert mission_server.resolve_by_time("20:00") is None


def test_corrupt_yaml_produces_useful_error(tmp_path):
    missions_dir = tmp_path / "missions"
    missions_dir.mkdir()
    with open(missions_dir / "broken.yaml", "w") as f:
        f.write("mission_id: [unterminated\n  name: broken")

    server = MissionServer(str(missions_dir), str(tmp_path / "app_state.yaml"))
    with pytest.raises(Exception) as excinfo:
        server.load()
    assert "broken.yaml" in str(excinfo.value)


def test_stale_app_state_reference_is_cleared(tmp_path):
    missions_dir = tmp_path / "missions"
    missions_dir.mkdir()
    app_state_path = tmp_path / "app_state.yaml"
    with open(app_state_path, "w") as f:
        yaml.safe_dump(
            {"current_mission_id": "ghost", "default_mission_id": "ghost"}, f
        )

    server = MissionServer(str(missions_dir), str(app_state_path))
    server.load()

    assert server.get_current() is None
    assert server.get_default() is None
    with open(app_state_path) as f:
        state = yaml.safe_load(f)
    assert state["current_mission_id"] is None
    assert state["default_mission_id"] is None
