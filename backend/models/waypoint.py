from pydantic import Field

from models.base import WireModel


class Waypoint(WireModel):
    waypoint_id: str
    x: float
    y: float
    # Goal heading: the lane's direction, set by the backend on save
    # (MissionService). None only if the map was unavailable then.
    yaw: float | None = None
    # How long the robot holds here before heading on.
    dwell_sec: float = Field(default=0.0, ge=0.0, le=600.0)
