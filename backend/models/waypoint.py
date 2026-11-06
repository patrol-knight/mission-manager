from models.base import WireModel


class Waypoint(WireModel):
    waypoint_id: str
    x: float
    y: float
    # Goal heading: the lane's direction, set by the backend on save
    # (MissionService). None only if the map was unavailable then.
    yaw: float | None = None
