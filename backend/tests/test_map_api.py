from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.map import router as map_router
from core.map_server import MapServer


def build_app(loaded: bool) -> FastAPI:
    app = FastAPI()
    app.include_router(map_router, prefix="/api/map", tags=["map"])
    map_server = MapServer()
    if loaded:
        map_server.load(
            "storage/maps/lanelet2_map.osm", "storage/maps/map_projector_info.yaml"
        )
    app.state.map_server = map_server
    return app


def test_map_unavailable_returns_503():
    client = TestClient(build_app(loaded=False))
    resp = client.get("/api/map/info")
    assert resp.status_code == 503
    assert "unavailable" in resp.json()["detail"].lower()


def test_map_bounds_unavailable_returns_503():
    client = TestClient(build_app(loaded=False))
    resp = client.get("/api/map/bounds")
    assert resp.status_code == 503


def test_map_info_when_loaded():
    client = TestClient(build_app(loaded=True))
    resp = client.get("/api/map/info")
    assert resp.status_code == 200
    body = resp.json()
    assert body["lanelet_count"] > 0


def test_map_bounds_when_loaded():
    client = TestClient(build_app(loaded=True))
    resp = client.get("/api/map/bounds")
    assert resp.status_code == 200
    bounds = resp.json()["bounds"]
    assert len(bounds) == 2


def test_is_in_lanelet_when_loaded():
    client = TestClient(build_app(loaded=True))
    resp = client.post("/api/map/is-in-lanelet", json={"x": 10.0, "y": 5.0})
    assert resp.status_code == 200
    assert "in_lanelet" in resp.json()
