import logging
import threading
import time

from core.device import BaseDevice
from core.errors import DeviceTypeMismatchError
from models.device import DeviceState, DeviceType, DeviceView

logger = logging.getLogger(__name__)


class DeviceRegistry:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._devices: dict[str, BaseDevice] = {}

    def upsert(self, state: DeviceState, received_at: float | None = None) -> bool:
        received_at = time.time() if received_at is None else received_at
        with self._lock:
            existing = self._devices.get(state.device_id)
            if existing is None:
                self._devices[state.device_id] = BaseDevice(state, received_at)
                return True

            if existing.state.type != state.type:
                logger.warning(
                    "Rejected device state for %s: type mismatch "
                    "(existing=%s, new=%s)",
                    state.device_id,
                    existing.state.type,
                    state.type,
                )
                raise DeviceTypeMismatchError(
                    f"Device {state.device_id} type mismatch: "
                    f"existing={existing.state.type}, new={state.type}"
                )

            return existing.apply(state, received_at)

    def get(self, device_id: str) -> DeviceView | None:
        with self._lock:
            device = self._devices.get(device_id)
            return device.to_view() if device else None

    def list_devices(self) -> list[DeviceView]:
        with self._lock:
            views = [device.to_view() for device in self._devices.values()]
        return sorted(views, key=lambda v: v.device_id)

    def get_robot(self) -> DeviceView | None:
        """The robot, connected or not -- lowest device_id if there are ever
        several (single-robot deployment)."""
        return self._first_robot(connected_only=False)

    def get_connected_robot(self) -> DeviceView | None:
        return self._first_robot(connected_only=True)

    def _first_robot(self, connected_only: bool) -> DeviceView | None:
        with self._lock:
            robots = [
                d for d in self._devices.values()
                if d.state.type == DeviceType.ROBOT and (d.connected or not connected_only)
            ]
            return min(robots, key=lambda d: d.state.device_id).to_view() if robots else None

    def mark_offline_devices(self, timeout_sec: float, now: float | None = None) -> list[DeviceView]:
        """Marks silent devices offline; returns the ones that just went offline."""
        now = time.time() if now is None else now
        with self._lock:
            return [
                device.to_view()
                for device in self._devices.values()
                if (now - device.last_seen) > timeout_sec and device.mark_offline()
            ]
