from typing import Literal

from pydantic import BaseModel


class Waypoint(BaseModel):
    waypoint_id: str
    x: float
    y: float
    yaw: float | None = None
    label: str | None = None
    type: Literal["patrol", "inspection", "charging", "custom"] = "patrol"
