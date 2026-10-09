"""The real lanelet2 map in storage/maps. Skipped where lanelet2 isn't installed
(it is in CI, from requirements.txt)."""

from pathlib import Path

import pytest

pytest.importorskip("lanelet2")

from core.map_server import MapServer  # noqa: E402
from core.mission_server import MissionServer  # noqa: E402

STORAGE = Path(__file__).resolve().parent.parent / "storage"


@pytest.fixture(scope="module")
def map_server() -> MapServer:
    server = MapServer()
    server.load(str(STORAGE / "maps" / "lanelet2_map.osm"), str(STORAGE / "maps" / "map_projector_info.yaml"))
    return server


@pytest.fixture(scope="module")
def waypoints():
    missions = MissionServer(str(STORAGE / "missions"), str(STORAGE / "app_state.yaml"))
    missions.load()
    return missions.get_mission("mission-2-tdpjxe").waypoints


def test_the_map_loads(map_server: MapServer):
    assert map_server.is_available()
    assert map_server.get_info().lanelet_count > 0


def test_mission_waypoints_are_on_lanelets(map_server: MapServer, waypoints):
    for wp in waypoints:
        snapped = map_server.snap_to_lanelet(wp.x, wp.y)
        assert snapped.lanelet_id is not None
        assert abs(snapped.x - wp.x) < 1.0 and abs(snapped.y - wp.y) < 1.0
        assert snapped.lat is not None and snapped.lon is not None


def test_routes_exist_between_mission_waypoints(map_server: MapServer, waypoints):
    for a, b in zip(waypoints, waypoints[1:] + waypoints[:1]):
        route = map_server.get_route([{"x": a.x, "y": a.y}, {"x": b.x, "y": b.y}])
        assert route is not None
        assert route["properties"]["length_m"] > 0
