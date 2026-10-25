from datetime import datetime
from enum import Enum

from pydantic import ConfigDict

from models.base import WireModel


class MissionStatus(str, Enum):
    # Idle, but the robot can't run a mission (disconnected, later also failed).
    NOT_READY = "not_ready"
    READY = "ready"
    RUNNING = "running"
    PAUSED = "paused"
    # Broadcast for a moment when the last loop finishes, then reset to READY
    # (see MissionExecutionManager._finish_mission).
    COMPLETED = "completed"


class MissionExecutionState(WireModel):
    """Runtime execution progress for whichever mission is current. Kept
    entirely separate from `Mission` (the persisted definition) — this is
    in-memory-only, never written to YAML. See core/mission_execution.py."""

    model_config = ConfigDict(extra="forbid")

    mission_id: str
    status: MissionStatus
    current_loop: int = 0
    completed_loops: int = 0
    # The last waypoint reached.
    current_waypoint_index: int = 0
    # Set while RUNNING or PAUSED.
    target_waypoint_index: int | None = None
    # Heading to where the robot joins the route (Start, or after an
    # investigation): reaching it finishes no loop, even at waypoint 0.
    joining: bool = False
    updated_at: datetime | None = None
