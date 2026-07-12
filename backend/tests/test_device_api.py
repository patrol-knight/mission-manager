import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.device import router as device_router
from core.device_registry import DeviceRegistry
from models.device import DeviceState, DeviceType, Pose2D


def build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(device_router, prefix="/api/devices", tags=["devices"])
    app.state.device_registry = DeviceRegistry()
    return app


@pytest.fixture
def app() -> FastAPI:
    return build_app()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def make_state(device_id="robot_01") -> DeviceState:
    return DeviceState(
        device_id=device_id,
        name="Robot 01",
        type=DeviceType.ROBOT,
        pose=Pose2D(x=1.0, y=2.0, yaw=0.5),
        timestamp=1760000000.0,
        battery=83.0,
        speed=0.5,
        status={},
        capabilities=["camera", "navigation", "battery"],
    )


def test_list_devices_empty(client: TestClient):
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_devices_after_upsert(app: FastAPI, client: TestClient):
    app.state.device_registry.upsert(make_state(), received_at=100.0)
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["device_id"] == "robot_01"
    assert body[0]["connected"] is True
    assert body[0]["battery"] == 83.0


def test_get_device(app: FastAPI, client: TestClient):
    app.state.device_registry.upsert(make_state(), received_at=100.0)
    resp = client.get("/api/devices/robot_01")
    assert resp.status_code == 200
    assert resp.json()["device_id"] == "robot_01"


def test_get_missing_device_returns_404(client: TestClient):
    resp = client.get("/api/devices/missing")
    assert resp.status_code == 404
