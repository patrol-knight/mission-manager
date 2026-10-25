from typing import Literal

from pydantic import ConfigDict, Field

from models.base import WireModel

CameraStreamStatus = Literal["idle", "connecting", "live", "no_signal", "offline", "error"]
CameraSessionState = Literal["idle", "starting", "negotiating", "streaming", "stopping"]
CameraVideoSource = Literal["live", "no_signal"]
CommandStatus = Literal["accepted", "running", "succeeded", "failed", "rejected"]

# Opaque to the backend, but bounded and printable -- the frontend sends a
# crypto.randomUUID(). Mirrors zenoh_bridge's own check.
SESSION_ID_PATTERN = r"^[A-Za-z0-9_-]{8,64}$"


class CameraState(WireModel):
    """Mirrors zenoh_bridge's CameraStatePayload (contract/types.hpp), published on
    devices/{device_id}/cameras/{camera_id}/state.

    `stream_state` is the legacy summary, derived by the gateway from
    `session_state`/`video_source`/`failure_code`. `(instance_id, revision)`
    orders states: revision increases with every change within one gateway
    process; instance_id changes when the gateway restarts."""

    model_config = ConfigDict(extra="forbid")

    device_id: str
    camera_id: str
    stream_state: CameraStreamStatus
    failure_reason: str | None = None
    timestamp: str
    session_id: str | None = None
    session_state: CameraSessionState = "idle"
    video_source: CameraVideoSource | None = None
    failure_code: str | None = None
    instance_id: str
    revision: int

    def public_view(self) -> dict:
        """What every WebSocket client may see: availability and health, not
        which session holds the camera (only its owner learns that)."""
        return self.model_dump(mode="json") | {"session_id": None}


class WebRtcSignal(WireModel):
    """Mirrors zenoh_bridge's WebRtcSignalPayload -- carried on both
    .../webrtc/to-device (backend -> gateway) and .../webrtc/to-backend
    (gateway -> backend). session_id is the frontend-generated id of the
    viewer session the negotiation belongs to."""

    model_config = ConfigDict(extra="forbid")

    session_id: str
    type: Literal["offer", "answer", "ice-candidate"]
    sdp: str | None = None
    candidate: str | None = None
    sdp_mline_index: int | None = None


class CommandResult(WireModel):
    """Mirrors zenoh_bridge's CommandResult, published on devices/{device_id}/events
    for every command. `accepted` only means queued; the outcome is one of
    running/succeeded/rejected/failed. The camera-session fields are null for
    other commands."""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    device_id: str
    command: str
    status: CommandStatus
    message: str | None = None
    timestamp: str
    session_id: str | None = None
    code: str | None = None
    instance_id: str | None = None
    state_revision: int | None = None


class StartCameraStreamRequest(WireModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(pattern=SESSION_ID_PATTERN)
    # The WebSocket connection (connection.ready's connection_id) that will
    # carry this session's signaling. Identifies the owner; not a credential.
    connection_id: str


class StopCameraStreamRequest(WireModel):
    model_config = ConfigDict(extra="forbid")

    connection_id: str


class CameraSessionInfo(WireModel):
    device_id: str
    camera_id: str
    session_id: str
    # Where the gateway says the session is -- "starting" right after
    # admission: a 201 means the gateway admitted it, not that video flows.
    session_state: CameraSessionState
