import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.websocket import router as websocket_router
from config import Settings
from core.device_registry import DeviceRegistry
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from transport.zenoh_gateway import ZenohGateway


def build_app(tmp_path) -> FastAPI:
    app = FastAPI()
    app.include_router(websocket_router)

    mission_server = MissionServer(
        mission_folder=str(tmp_path / "missions"),
        app_state_path=str(tmp_path / "app_state.yaml"),
    )
    mission_server.load()

    app.state.settings = Settings(zenoh_enabled=False)
    app.state.mission_server = mission_server
    app.state.device_registry = DeviceRegistry()
    app.state.websocket_manager = WebSocketManager()
    app.state.zenoh_gateway = ZenohGateway(
        app.state.settings, app.state.device_registry, app.state.websocket_manager
    )
    return app


@pytest.fixture
def app(tmp_path) -> FastAPI:
    return build_app(tmp_path)


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def test_initial_ready_and_snapshot_events(client: TestClient):
    with client.websocket_connect("/ws") as ws:
        ready = ws.receive_json()
        assert ready == {"type": "connection.ready", "data": {"protocol_version": 1}}

        snapshot = ws.receive_json()
        assert snapshot == {"type": "devices.snapshot", "data": []}

        mission_current = ws.receive_json()
        assert mission_current == {"type": "mission.current", "data": None}


def test_ping_pong(client: TestClient):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # connection.ready
        ws.receive_json()  # devices.snapshot
        ws.receive_json()  # mission.current

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_unknown_message_type_does_not_crash_connection(client: TestClient):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()

        ws.send_json({"type": "totally.unknown"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}


def test_broadcast_to_multiple_clients(app: FastAPI, client: TestClient):
    with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
        for ws in (ws1, ws2):
            ws.receive_json()
            ws.receive_json()
            ws.receive_json()

        app.state.websocket_manager.broadcast_threadsafe(
            {"type": "error", "data": {"message": "test broadcast"}}
        )

        for ws in (ws1, ws2):
            msg = ws.receive_json()
            assert msg == {"type": "error", "data": {"message": "test broadcast"}}


def test_device_update_propagation_via_ingest(app: FastAPI, client: TestClient):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.receive_json()
        ws.receive_json()

        payload = {
            "device_id": "robot_01",
            "name": "Robot 01",
            "type": "robot",
            "pose": {"frame_id": "map", "x": 10.2, "y": 5.3, "yaw": 1.57},
            "timestamp": 1760000000.0,
            "battery": 83.0,
            "speed": 0.5,
            "status": {"navigation_state": "moving"},
            "capabilities": ["camera", "navigation", "battery"],
        }
        changed = app.state.zenoh_gateway.ingest_device_payload(payload)
        assert changed is True

        event = ws.receive_json()
        assert event["type"] == "device.updated"
        assert event["data"]["device_id"] == "robot_01"
        assert event["data"]["battery"] == 83.0
        assert event["data"]["connected"] is True


def test_ingest_malformed_payload_does_not_crash(app: FastAPI):
    changed = app.state.zenoh_gateway.ingest_device_payload(b"not json")
    assert changed is False
