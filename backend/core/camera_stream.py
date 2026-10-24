import uuid

from core.camera_registry import CameraRegistry
from core.device_registry import DeviceRegistry
from core.websocket_manager import WebSocketManager
from core.errors import (
    CameraUnavailableError,
    DeviceNotConnectedError,
    DeviceNotFoundError,
    DeviceUnreachableError,
)
from transport.zenoh_gateway import ZenohGateway


def _new_session_id() -> str:
    return f"req-{uuid.uuid4().hex[:12]}"


class CameraStreamService:
    """Starts/stops a device camera's WebRTC stream by commanding the
    device's gateway. Only the intent goes through here -- the offer/answer/
    ICE exchange rides the WebSocket as camera.signal messages (see
    api/websocket.py and ../../zenoh_bridge/docs/video_streaming_pipeline.md)."""

    def __init__(
        self,
        device_registry: DeviceRegistry,
        camera_registry: CameraRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._devices = device_registry
        self._cameras = camera_registry
        self._gateway = zenoh_gateway
        self._websocket = websocket_manager

    def start(self, device_id: str, camera_id: str, connection_id: str | None = None) -> str:
        """Returns the session id that ties the following camera.signal
        messages to this request."""
        device = self._devices.get(device_id)
        if device is None:
            raise DeviceNotFoundError(f"Device not found: {device_id}")

        # zenoh_bridge doesn't populate DeviceState.capabilities today
        # (nothing derives "camera" from a configured camera before relaying
        # to Zenoh -- see ros_state_relay.cpp), so capabilities alone would
        # reject every real device. CameraRegistry, fed by the camera-state
        # relay, is the reliable signal. Same fallback as the frontend's
        # DeviceInspectorOverlay.tsx hasCameraCapability.
        known_camera = self._cameras.get(device_id)
        has_camera = "camera" in device.capabilities or (
            known_camera is not None and known_camera.camera_id == camera_id
        )
        if not has_camera:
            raise CameraUnavailableError(f"Device has no camera capability: {device_id}")
        if not device.connected:
            raise DeviceNotConnectedError(f"Device not connected: {device_id}")

        session_id = _new_session_id()
        if connection_id is not None:
            self._websocket.bind_session(session_id, connection_id)
        if not self._gateway.publish_command(device_id, "start_camera_stream", session_id, {"camera_id": camera_id}):
            self._websocket.unbind_session(session_id)
            raise DeviceUnreachableError(f"Unable to reach device: {device_id}")
        return session_id

    def stop(self, device_id: str, camera_id: str, session_id: str) -> None:
        """Idempotent (matches zenoh_bridge's handle_stop): stopping an
        already-idle camera still succeeds."""
        self._websocket.unbind_session(session_id)
        self._gateway.publish_command(device_id, "stop_camera_stream", _new_session_id(), {"camera_id": camera_id})
