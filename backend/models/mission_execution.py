from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class MissionStatus(str, Enum):
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    RETURNING_HOME = "returning_home"
    COMPLETED = "completed"


class MissionExecutionState(BaseModel):
    """Runtime execution progress for whichever mission is current. Kept
    entirely separate from `Mission` (the persisted definition) — this is
    in-memory-only, never written to YAML. See core/mission_execution.py."""

    model_config = ConfigDict(extra="forbid")

    mission_id: str
    status: MissionStatus
    current_loop: int = 0
    completed_loops: int = 0
    current_waypoint_index: int = 0
    updated_at: datetime | None = None
