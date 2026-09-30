from typing import Literal

from pydantic import BaseModel, ConfigDict

CameraStreamStatus = Literal["idle", "connecting", "live", "no_signal", "offline", "error"]


class CameraState(BaseModel):
    """Mirrors zenoh_bridge's CameraStatePayload (contract/types.hpp), published on
    devices/{device_id}/cameras/{camera_id}/state."""

    model_config = ConfigDict(extra="forbid")

    device_id: str
    camera_id: str
    stream_state: CameraStreamStatus
    failure_reason: str | None = None
    timestamp: str


class WebRtcSignal(BaseModel):
    """Mirrors zenoh_bridge's WebRtcSignalPayload -- carried on both
    .../webrtc/to-device (backend -> gateway) and .../webrtc/to-backend
    (gateway -> backend). session_id ties every payload to the
    start_camera_stream request_id that kicked off the negotiation."""

    model_config = ConfigDict(extra="forbid")

    session_id: str
    type: Literal["offer", "answer", "ice-candidate"]
    sdp: str | None = None
    candidate: str | None = None
    sdp_mline_index: int | None = None
