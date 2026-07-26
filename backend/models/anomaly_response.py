from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict

from models.map import MapPoint


class DiversionPhase(str, Enum):
    """In-memory only (core/anomaly_response.py) -- never persisted, same
    precedent as MissionExecutionState."""

    OUTBOUND = "outbound"
    AWAITING_RESOLUTION = "awaiting_resolution"
    RETURNING = "returning"


class DiversionStarted(BaseModel):
    """Broadcast as anomaly.diversion.started. `route` is the same
    GeoJSON Feature shape MapServer.get_route()/get_route_preview() already
    return (lng/lat coordinates, ready for useGeoJsonLineLayer)."""

    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    robot_device_id: str
    route: dict
    target: MapPoint
    started_at: datetime


class DiversionReturning(BaseModel):
    """Broadcast as anomaly.diversion.returning."""

    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    robot_device_id: str
    route: dict
    target_waypoint_id: str
    started_at: datetime
