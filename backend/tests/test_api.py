"""The HTTP/WebSocket surface: error mapping and snapshots, with no map or
devices -- the app must stay usable for mission authoring alone."""

import pytest
from fastapi.testclient import TestClient


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/map/geojson", None),
        ("GET", "/api/map/bounds", None),
        ("POST", "/api/map/place-waypoint", {"lat": 0, "lon": 0}),
        ("POST", "/api/map/xy-to-lnglat", {"x": 0, "y": 0}),
        ("POST", "/api/map/route-preview", {"waypoints": [{"x": 0, "y": 0}, {"x": 1, "y": 1}]}),
    ],
)
def test_map_endpoints_are_503_without_a_map(client: TestClient, method, path, body):
    response = client.request(method, path, json=body)
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"]


@pytest.mark.parametrize(
    "path",
    ["/api/missions/nope", "/api/devices/nope", "/api/anomalies/nope"],
)
def test_unknown_ids_are_404(client: TestClient, path):
    assert client.get(path).status_code == 404


def test_no_investigation_to_stop_is_409(client: TestClient):
    assert client.post("/api/investigation/stop").status_code == 409


def test_system_status_without_a_database(client: TestClient):
    assert client.get("/api/system/status").json() == {"database": {"configured": False, "connected": False}}


def test_websocket_sends_a_full_snapshot_on_connect(client: TestClient):
    with client.websocket_connect("/ws") as ws:
        types = [ws.receive_json()["type"] for _ in range(7)]
        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}
    assert types == [
        "connection.ready",
        "devices.snapshot",
        "mission.current",
        "mission.execution",
        "cameras.snapshot",
        "anomalies.snapshot",
        "investigation.updated",
    ]


def test_only_devices_that_just_went_silent_are_reported_offline():
    from core.device_registry import DeviceRegistry
    from models.device import DeviceState

    registry = DeviceRegistry()
    for device_id, seen in (("iot-a", 0.0), ("iot-b", 9.0)):
        registry.upsert(DeviceState(device_id=device_id, type="iot", pose={"x": 0, "y": 0}, timestamp=seen), seen)

    assert [d.device_id for d in registry.mark_offline_devices(3.0, now=10.0)] == ["iot-a"]
    assert registry.mark_offline_devices(3.0, now=10.0) == []  # already offline
