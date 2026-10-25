"""Device state ingest and connectivity."""

from core.device_registry import DeviceRegistry
from models.device import DeviceState
from tests.conftest import Sim

ROBOT = {"device_id": "robot-1", "type": "robot", "pose": {"x": 1, "y": 2}, "timestamp": 1.0}


def test_ingest_rejects_malformed_payloads_and_type_changes(sim: Sim):
    gateway = sim.services.zenoh_gateway
    assert not gateway.ingest_device_payload(b"not json")
    assert not gateway.ingest_device_payload({**ROBOT, "unknown_field": 1})
    assert gateway.ingest_device_payload(ROBOT)
    assert not gateway.ingest_device_payload({**ROBOT, "type": "iot", "timestamp": 2.0})
    assert sim.client.get("/api/devices/robot-1").json()["type"] == "robot"


def test_only_meaningful_changes_are_broadcast(sim: Sim):
    gateway = sim.services.zenoh_gateway
    assert gateway.ingest_device_payload(ROBOT)
    assert not gateway.ingest_device_payload({**ROBOT, "timestamp": 2.0})  # same pose and status
    assert gateway.ingest_device_payload({**ROBOT, "pose": {"x": 5, "y": 2}, "timestamp": 3.0})


def test_only_devices_that_just_went_silent_are_reported_offline():
    registry = DeviceRegistry()
    for device_id, seen in (("iot-a", 0.0), ("iot-b", 9.0)):
        registry.upsert(DeviceState(device_id=device_id, type="iot", pose={"x": 0, "y": 0}, timestamp=seen), seen)

    assert [d.device_id for d in registry.mark_offline_devices(3.0, now=10.0)] == ["iot-a"]
    assert registry.mark_offline_devices(3.0, now=10.0) == []  # already offline
