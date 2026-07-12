import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.camera import router as camera_router
from core.device_registry import DeviceRegistry
from models.device import DeviceState, DeviceType, Pose2D


def build_app() -> FastAPI:
    app = FastAPI()
    app.include_router(camera_router, prefix="/api/cameras", tags=["cameras"])
    app.state.device_registry = DeviceRegistry()
    return app


@pytest.fixture
def app() -> FastAPI:
    return build_app()


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def test_session_missing_device_returns_404(client: TestClient):
    resp = client.post("/api/cameras/missing/session")
    assert resp.status_code == 404


def test_session_device_without_camera_capability_returns_400(app: FastAPI, client: TestClient):
    app.state.device_registry.upsert(
        DeviceState(
            device_id="robot_01",
            type=DeviceType.ROBOT,
            pose=Pose2D(x=0, y=0),
            timestamp=1.0,
            capabilities=["navigation"],
        ),
        received_at=1.0,
    )
    resp = client.post("/api/cameras/robot_01/session")
    assert resp.status_code == 400


def test_session_with_camera_capability_returns_501(app: FastAPI, client: TestClient):
    app.state.device_registry.upsert(
        DeviceState(
            device_id="robot_01",
            type=DeviceType.ROBOT,
            pose=Pose2D(x=0, y=0),
            timestamp=1.0,
            capabilities=["camera", "navigation"],
        ),
        received_at=1.0,
    )
    resp = client.post("/api/cameras/robot_01/session")
    assert resp.status_code == 501
