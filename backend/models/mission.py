import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.waypoint import Waypoint

_MISSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
class Mission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_id: str
    name: str
    # Filled in from the loaded map when left empty (MissionService).
    map_name: str = ""
    frame_id: str = "map"

    description: str | None = None
    waypoints: list[Waypoint] = Field(default_factory=list)
    loop_count: int = Field(default=1, ge=1)
    # Loop until the operator stops it; loop_count is kept (not used while
    # this is set) so unticking it restores the previous count.
    infinite_loop: bool = False

    created_at: datetime | None = None
    updated_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def drop_legacy_fields(cls, data: Any) -> Any:
        # Mission files written before time slots were removed still carry
        # `time_slot: null`; ignore it rather than fail to load them.
        if isinstance(data, dict) and "time_slot" in data:
            data = {k: v for k, v in data.items() if k != "time_slot"}
        return data

    @field_validator("mission_id")
    @classmethod
    def validate_mission_id(cls, value: str) -> str:
        if not value:
            raise ValueError("mission_id must not be empty")
        if not _MISSION_ID_RE.match(value):
            raise ValueError(
                "mission_id must contain only letters, digits, '_' and '-'"
            )
        return value

    @model_validator(mode="after")
    def validate_waypoint_ids(self) -> "Mission":
        ids = [wp.waypoint_id for wp in self.waypoints]
        for wp_id in ids:
            if not wp_id:
                raise ValueError("waypoint_id must not be empty")
        if len(ids) != len(set(ids)):
            raise ValueError("waypoint_id values must be unique within a mission")
        return self


class MissionSummary(BaseModel):
    mission_id: str
    name: str
    map_name: str
    frame_id: str = "map"
    waypoint_count: int
    loop_count: int = Field(default=1, ge=1)
    home_x: float | None = None
    home_y: float | None = None
    distance_m: float | None = None
    infinite_loop: bool = False
    is_current: bool = False
    updated_at: datetime | None = None


class WaypointGeo(Waypoint):
    """Response-only Waypoint plus its lat/lon, computed server-side with
    MapServer's lanelet2 projector (null whenever the map is unavailable).
    Never persisted -- the YAML files hold plain Waypoints. Lets the
    frontend's map layers render waypoints with no per-marker xy-to-lnglat
    round trip."""

    lat: float | None = None
    lon: float | None = None


class MissionGeo(Mission):
    waypoints: list[WaypointGeo]
