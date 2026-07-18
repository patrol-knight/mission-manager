import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.waypoint import Waypoint

_MISSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class TimeSlot(BaseModel):
    start: str | None = None
    end: str | None = None

    @field_validator("start", "end")
    @classmethod
    def validate_hhmm(cls, value: str | None) -> str | None:
        if value is None:
            return value
        if not _HHMM_RE.match(value):
            raise ValueError(f"Invalid HH:MM time: {value!r}")
        return value


class Mission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mission_id: str
    name: str
    map_name: str
    frame_id: str = "map"

    description: str | None = None
    time_slot: TimeSlot | None = None
    waypoints: list[Waypoint] = Field(default_factory=list)

    created_at: datetime | None = None
    updated_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

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
    time_slot: TimeSlot | None = None
    is_current: bool = False
    is_default: bool = False
    updated_at: datetime | None = None
