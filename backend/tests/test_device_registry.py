import threading

import pytest

from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError
from models.device import DeviceState, DeviceType, Pose2D


def make_state(device_id="robot_01", x=0.0, y=0.0, yaw=0.0, **overrides) -> DeviceState:
    defaults = dict(
        device_id=device_id,
        name="Robot 01",
        type=DeviceType.ROBOT,
        pose=Pose2D(x=x, y=y, yaw=yaw),
        timestamp=1760000000.0,
        battery=80.0,
        speed=0.5,
        status={},
        capabilities=["camera", "navigation"],
    )
    defaults.update(overrides)
    return DeviceState(**defaults)


@pytest.fixture
def registry() -> DeviceRegistry:
    return DeviceRegistry()


def test_new_device_insertion_returns_true(registry: DeviceRegistry):
    changed = registry.upsert(make_state(), received_at=100.0)
    assert changed is True
    view = registry.get("robot_01")
    assert view is not None
    assert view.connected is True
    assert view.last_seen == 100.0


def test_update_with_no_meaningful_change_returns_false(registry: DeviceRegistry):
    registry.upsert(make_state(), received_at=100.0)
    changed = registry.upsert(make_state(timestamp=1760000005.0), received_at=101.0)
    assert changed is False


def test_pose_update_returns_true(registry: DeviceRegistry):
    registry.upsert(make_state(x=0.0, y=0.0), received_at=100.0)
    changed = registry.upsert(make_state(x=5.0, y=0.0), received_at=101.0)
    assert changed is True


def test_pose_within_float_tolerance_returns_false(registry: DeviceRegistry):
    registry.upsert(make_state(x=0.0, y=0.0, yaw=0.0), received_at=100.0)
    changed = registry.upsert(
        make_state(x=0.0000005, y=0.0, yaw=0.0000005), received_at=101.0
    )
    assert changed is False


def test_reconnection_returns_true(registry: DeviceRegistry):
    registry.upsert(make_state(), received_at=100.0)
    registry.mark_offline_devices(timeout_sec=1.0, now=200.0)
    assert registry.get("robot_01").connected is False

    changed = registry.upsert(make_state(), received_at=201.0)
    assert changed is True
    assert registry.get("robot_01").connected is True


def test_type_mismatch_raises(registry: DeviceRegistry):
    registry.upsert(make_state(type=DeviceType.ROBOT), received_at=100.0)
    with pytest.raises(DeviceTypeMismatchError):
        registry.upsert(make_state(type=DeviceType.IOT), received_at=101.0)


def test_backend_receive_time_controls_last_seen(registry: DeviceRegistry):
    registry.upsert(make_state(timestamp=1.0), received_at=500.0)
    view = registry.get("robot_01")
    assert view.last_seen == 500.0
    assert view.timestamp == 1.0


def test_device_timestamp_does_not_control_connectivity(registry: DeviceRegistry):
    # Device timestamp is far in the past/future; connectivity must only
    # depend on backend receive time (`received_at`), not this field.
    registry.upsert(make_state(timestamp=9999999999.0), received_at=100.0)
    changed = registry.mark_offline_devices(timeout_sec=1.0, now=100.5)
    assert changed is False
    assert registry.get("robot_01").connected is True


def test_offline_transition_after_timeout(registry: DeviceRegistry):
    registry.upsert(make_state(), received_at=100.0)
    changed = registry.mark_offline_devices(timeout_sec=3.0, now=104.0)
    assert changed is True
    assert registry.get("robot_01").connected is False


def test_no_repeated_change_when_already_offline(registry: DeviceRegistry):
    registry.upsert(make_state(), received_at=100.0)
    assert registry.mark_offline_devices(timeout_sec=3.0, now=104.0) is True
    assert registry.mark_offline_devices(timeout_sec=3.0, now=110.0) is False


def test_deterministic_sorting(registry: DeviceRegistry):
    registry.upsert(make_state(device_id="robot_02"), received_at=1.0)
    registry.upsert(make_state(device_id="robot_01"), received_at=1.0)
    registry.upsert(make_state(device_id="robot_03"), received_at=1.0)

    ids = [d.device_id for d in registry.list_devices()]
    assert ids == ["robot_01", "robot_02", "robot_03"]


def test_thread_safety_with_concurrent_upserts(registry: DeviceRegistry):
    def worker(i: int):
        for j in range(50):
            registry.upsert(
                make_state(device_id=f"robot_{i}", x=float(j)), received_at=float(j)
            )

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(registry.list_devices()) == 8
