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


class DeviceFixture(BaseModel):
    """One entry in simulation/fixtures/devices.yaml — seeds the dev simulator's
    initial device position/enabled-state instead of its hardcoded/random
    defaults. Not used outside DevSimulator."""

    model_config = ConfigDict(extra="forbid")

    device_id: str
    type: DeviceType
    enabled: bool = True
    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0


class DeviceFixtureFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    devices: list[DeviceFixture] = Field(default_factory=list)
