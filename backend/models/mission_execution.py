from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


class MissionStatus(str, Enum):
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    # Driving back to waypoint 0 -- after Stop, or after an investigation
    # that started while the mission was READY. READY again on arrival.
    RETURNING = "returning"
    # Broadcast for a moment when the last loop finishes, then reset to READY
    # (see MissionExecutionManager._finish_mission).
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
