from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class DeviceType(str, Enum):
    ROBOT = "robot"
    IOT = "iot"


class Pose2D(BaseModel):
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


class DeviceState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_id: str
    name: str | None = None
    type: DeviceType

    pose: Pose2D
    timestamp: float

    battery: float | None = Field(default=None, ge=0.0, le=100.0)
    speed: float | None = None

    status: dict[str, Any] = Field(default_factory=dict)
    capabilities: list[str] = Field(default_factory=list)


class DeviceView(DeviceState):
    connected: bool
    last_seen: float
