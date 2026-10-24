import threading

from models.camera import CameraState


def is_newer(candidate: CameraState, current: CameraState) -> bool:
    """Whether `candidate` supersedes `current` for the same device.

    Within one gateway process `revision` increases with every state change
    (re-publishes of an unchanged state repeat it). A different `instance_id`
    means the gateway restarted; samples from the old and new process can
    still arrive in either order, so the device's own timestamp decides."""
    if candidate.instance_id == current.instance_id:
        return candidate.revision > current.revision
    return candidate.timestamp >= current.timestamp  # same ISO 8601 UTC format on both


class CameraRegistry:
    """In-memory {device_id: CameraState} -- one entry per device, since every
    device deployed today has at most one camera (see
    ../../zenoh_bridge/docs/video_streaming_pipeline.md's scope note). Mirrors
    DeviceRegistry's shape (core/device_registry.py) but with no
    connected/last_seen tracking -- the gateway reports session and video
    state itself. Only ever moves forward: an older state arriving late (or a
    periodic re-publish of the current one) is ignored."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cameras: dict[str, CameraState] = {}

    def upsert(self, state: CameraState) -> bool:
        """Stores `state` if it's newer than what's known. Returns whether it
        was stored."""
        with self._lock:
            existing = self._cameras.get(state.device_id)
            if existing is not None and not is_newer(state, existing):
                return False
            self._cameras[state.device_id] = state
            return True

    def get(self, device_id: str) -> CameraState | None:
        with self._lock:
            return self._cameras.get(device_id)

    def list(self) -> list[CameraState]:
        with self._lock:
            return sorted(self._cameras.values(), key=lambda c: c.device_id)
