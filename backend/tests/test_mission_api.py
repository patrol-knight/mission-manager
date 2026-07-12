import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.mission import router as mission_router
from core.mission_server import MissionServer


def build_app(tmp_path) -> FastAPI:
    app = FastAPI()
    app.include_router(mission_router, prefix="/api/missions", tags=["missions"])
    server = MissionServer(
        mission_folder=str(tmp_path / "missions"),
        app_state_path=str(tmp_path / "app_state.yaml"),
    )
    server.load()
    app.state.mission_server = server
    return app


@pytest.fixture
def client(tmp_path) -> TestClient:
    return TestClient(build_app(tmp_path))


def sample_payload(mission_id="m1", **overrides) -> dict:
    payload = {
        "mission_id": mission_id,
        "name": "Mission One",
        "map_name": "warehouse_main",
        "waypoints": [{"waypoint_id": "wp_001", "x": 1.0, "y": 2.0}],
    }
    payload.update(overrides)
    return payload


def test_list_empty(client: TestClient):
    resp = client.get("/api/missions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_mission(client: TestClient):
    resp = client.post("/api/missions", json=sample_payload())
    assert resp.status_code == 200
    body = resp.json()
    assert body["mission_id"] == "m1"
    assert body["created_at"] is not None


def test_create_duplicate_returns_409(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.post("/api/missions", json=sample_payload())
    assert resp.status_code == 409


def test_create_invalid_mission_id_returns_422(client: TestClient):
    resp = client.post("/api/missions", json=sample_payload(mission_id="bad id!"))
    assert resp.status_code == 422


def test_get_mission(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.get("/api/missions/m1")
    assert resp.status_code == 200
    assert resp.json()["mission_id"] == "m1"


def test_get_missing_mission_returns_404(client: TestClient):
    resp = client.get("/api/missions/missing")
    assert resp.status_code == 404


def test_list_returns_summaries_without_waypoints(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.get("/api/missions")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert "waypoints" not in body[0]
    assert body[0]["waypoint_count"] == 1


def test_update_mission(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.put("/api/missions/m1", json=sample_payload(name="Renamed"))
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


def test_update_missing_mission_returns_404(client: TestClient):
    resp = client.put("/api/missions/missing", json=sample_payload(mission_id="missing"))
    assert resp.status_code == 404


def test_update_conflicting_body_id_returns_400(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.put("/api/missions/m1", json=sample_payload(mission_id="other"))
    assert resp.status_code == 400


def test_delete_mission_returns_204(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.delete("/api/missions/m1")
    assert resp.status_code == 204
    assert client.get("/api/missions/m1").status_code == 404


def test_delete_missing_mission_returns_404(client: TestClient):
    resp = client.delete("/api/missions/missing")
    assert resp.status_code == 404


def test_current_and_default_missing_return_404(client: TestClient):
    assert client.get("/api/missions/current").status_code == 404
    assert client.get("/api/missions/default").status_code == 404


def test_activate_and_get_current(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.post("/api/missions/m1/activate")
    assert resp.status_code == 200

    current = client.get("/api/missions/current")
    assert current.status_code == 200
    assert current.json()["mission_id"] == "m1"


def test_set_default_and_get_default(client: TestClient):
    client.post("/api/missions", json=sample_payload())
    resp = client.post("/api/missions/m1/set-default")
    assert resp.status_code == 200

    default = client.get("/api/missions/default")
    assert default.status_code == 200
    assert default.json()["mission_id"] == "m1"


def test_activate_missing_mission_returns_404(client: TestClient):
    resp = client.post("/api/missions/missing/activate")
    assert resp.status_code == 404
