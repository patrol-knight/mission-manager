"""Restricted zones: edited on the map as lat/lon, stored per map as map-frame
x/y, and given to Anomaly Detection through a Zenoh query."""

import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from bootstrap import Services
from config import Settings
from core.geofence_server import GeofenceServer
from models.geofence import GeofenceSet
from models.map import LatLon, XY
from transport.zenoh_gateway import ZenohGateway

SQUARE = [{"lat": 1.0, "lon": 2.0}, {"lat": 1.0, "lon": 3.0}, {"lat": 2.0, "lon": 3.0}]
ZONES = {"zones": [{"zone_id": "zone_1", "points": SQUARE}]}


class LinearMap:
    """x = lon * 10, y = lat * 10."""

    def latlon_to_xy(self, lat: float, lon: float) -> XY:
        return XY(x=lon * 10.0, y=lat * 10.0)

    def xy_to_latlon(self, x: float, y: float) -> LatLon:
        return LatLon(lat=y / 10.0, lon=x / 10.0)


@pytest.fixture
def server(tmp_path: Path) -> GeofenceServer:
    return GeofenceServer(str(tmp_path / "zones"), "nsh", LinearMap())


@pytest.fixture
def api(client: TestClient, services: Services, server: GeofenceServer, monkeypatch) -> TestClient:
    monkeypatch.setattr(services, "geofences", server)
    return client


def test_a_map_with_no_file_has_no_zones_and_no_reply(api: TestClient, server: GeofenceServer):
    assert api.get("/api/geofences").json() == {"zones": []}
    assert server.wire_payload() is None


def test_saved_zones_round_trip_and_are_stored_in_the_map_frame(api: TestClient, server: GeofenceServer, tmp_path: Path):
    assert api.put("/api/geofences", json=ZONES).json() == ZONES
    assert api.get("/api/geofences").json() == ZONES

    assert yaml.safe_load((tmp_path / "zones" / "nsh.yaml").read_text()) == {
        "map_name": "nsh",
        "restricted_zones": {"zone_1": {"frame_id": "map", "polygon": [[20.0, 10.0], [30.0, 10.0], [30.0, 20.0]]}},
    }
    assert json.loads(server.wire_payload()) == {
        "restricted_zones": {"zone_1": {"frame_id": "map", "polygon": [[20.0, 10.0], [30.0, 10.0], [30.0, 20.0]]}},
    }


def test_removing_every_zone_clears_them_instead_of_going_silent(api: TestClient, server: GeofenceServer):
    api.put("/api/geofences", json=ZONES)
    assert api.put("/api/geofences", json={"zones": []}).status_code == 200
    assert json.loads(server.wire_payload()) == {"restricted_zones": {}}


def test_zones_survive_a_restart(api: TestClient, server: GeofenceServer, tmp_path: Path):
    api.put("/api/geofences", json=ZONES)
    restarted = GeofenceServer(str(tmp_path / "zones"), "nsh", LinearMap())
    restarted.load()
    assert restarted.zones().model_dump() == ZONES


def test_each_map_only_sees_its_own_zones(api: TestClient, tmp_path: Path):
    api.put("/api/geofences", json=ZONES)
    other_map = GeofenceServer(str(tmp_path / "zones"), "ks", LinearMap())
    other_map.load()
    assert other_map.wire_payload() is None


def test_a_file_written_for_another_map_is_ignored(tmp_path: Path):
    (tmp_path / "nsh.yaml").write_text("map_name: ks\nrestricted_zones: {}\n")
    server = GeofenceServer(str(tmp_path), "nsh", LinearMap())
    server.load()
    assert server.wire_payload() is None


@pytest.mark.parametrize(
    "body",
    [
        {"zones": [{"zone_id": "z", "points": SQUARE[:2]}]},
        {"zones": [{"zone_id": "a/b", "points": SQUARE}]},
        {"zones": [{"zone_id": "z", "points": SQUARE}, {"zone_id": "z", "points": SQUARE}]},
        {"zones": [{"zone_id": "z", "points": [{"lat": 91, "lon": 0}, *SQUARE[:2]]}]},
    ],
)
def test_invalid_zones_are_rejected_and_nothing_is_saved(api: TestClient, server: GeofenceServer, body):
    assert api.put("/api/geofences", json=body).status_code == 422
    assert server.wire_payload() is None


def test_saving_needs_a_map(client: TestClient):
    assert client.put("/api/geofences", json=ZONES).status_code == 503


class FakeQuery:
    def __init__(self) -> None:
        self.replies: list[tuple[str, bytes]] = []

    def reply(self, key: str, payload: bytes) -> None:
        self.replies.append((key, payload))


def gateway(server: GeofenceServer) -> ZenohGateway:
    return ZenohGateway(Settings(_env_file=None), None, None, None, None, None, server)


def test_the_gateway_replies_only_once_zones_are_saved(server: GeofenceServer):
    silent, answered = FakeQuery(), FakeQuery()
    gateway(server)._on_geofence_query(silent)
    assert silent.replies == []

    server.replace(GeofenceSet(zones=[]))
    gateway(server)._on_geofence_query(answered)
    assert answered.replies == [("geofences/restricted_zones", b'{"restricted_zones": {}}')]
