import threading

from models.camera import CameraState


class CameraRegistry:
    """In-memory {device_id: CameraState} -- one entry per device, since every
    device deployed today has at most one camera (see
    ../../zenoh_bridge/docs/video_streaming_pipeline.md's scope note). Mirrors
    DeviceRegistry's shape (core/device_registry.py) but with no
    connected/last_seen tracking -- stream liveness is `stream_state` itself,
    reported by the gateway's own frame-arrival watchdog."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cameras: dict[str, CameraState] = {}

    def upsert(self, state: CameraState) -> bool:
        with self._lock:
            existing = self._cameras.get(state.device_id)
            changed = (
                existing is None
                or existing.camera_id != state.camera_id
                or existing.stream_state != state.stream_state
                or existing.failure_reason != state.failure_reason
            )
            self._cameras[state.device_id] = state
            return changed

    def get(self, device_id: str) -> CameraState | None:
        with self._lock:
            return self._cameras.get(device_id)

    def list(self) -> list[CameraState]:
        with self._lock:
            return sorted(self._cameras.values(), key=lambda c: c.device_id)
