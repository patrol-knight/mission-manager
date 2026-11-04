from enum import Enum
from typing import Any

from pydantic import ConfigDict, Field

from models.base import WireModel

# The only operational_state values a robot can take a mission in; anything
# else, including a missing state, counts as not ready.
ROBOT_AVAILABLE_STATES = ("idle", "navigating", "arrived")


class DeviceType(str, Enum):
    ROBOT = "robot"
    IOT = "iot"


class Pose2D(WireModel):
    frame_id: str = "map"
    x: float
    y: float
    yaw: float = 0.0
    # Computed once, server-side, at Zenoh ingest time (see
    # transport/zenoh_gateway.py's ingest_device_payload) using MapServer's
    # real lanelet2 projector -- never set by an incoming device payload
    # itself (device_gateway only knows local x/y). Carried through every
    # broadcast/REST response so the frontend never needs a per-marker
    # xy-to-lnglat round trip for a continuously-updating device position.
    # Null whenever the map service is unavailable.
    lat: float | None = None
    lon: float | None = None


class DeviceState(WireModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str
    name: str | None = None
    type: DeviceType

    # None while the robot isn't localized (zenoh_bridge sends "pose": null).
    pose: Pose2D | None = None
    timestamp: float

    battery: float | None = Field(default=None, ge=0.0, le=100.0)
    speed: float | None = None

    status: dict[str, Any] = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list)


class DeviceView(DeviceState):
    connected: bool
    last_seen: float

    @property
    def operational_state(self) -> str | None:
        return self.status.get("operational_state")

    @property
    def mode(self) -> str | None:
        """Who drives: auto / manual / none (state_machine's /robot_mode)."""
        return self.status.get("mode")

    @property
    def unavailable_reason(self) -> str | None:
        """manual / failure / notready, or None when the robot can take a mission."""
        # Autoware's own "manual" still arrives as an operational_state.
        if self.mode == "manual" or self.operational_state == "manual":
            return "manual"
        if self.operational_state == "failure":
            return "failure"
        return None if self.operational_state in ROBOT_AVAILABLE_STATES else "notready"

    @property
    def unavailable(self) -> bool:
        return self.unavailable_reason is not None
