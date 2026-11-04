from enum import Enum

from models.camera import CommandResult

# state_machine never got the goal: sending it again is safe.
RESEND_CODES = frozenset({"goal_dropped", "state_machine_unavailable"})


class GoalOutcome(str, Enum):
    RUNNING = "running"
    ARRIVED = "arrived"
    RESEND = "resend"
    FAILED = "failed"
    IGNORE = "ignore"


def classify(result: CommandResult) -> tuple[GoalOutcome, str | None]:
    """What a navigate_to_goal CommandResult means for the goal it answers,
    and the failure reason (state_machine's code) when it failed."""
    status = result.status
    if status == "running":
        return GoalOutcome.RUNNING, None
    if status == "succeeded":
        return GoalOutcome.ARRIVED, None
    if status in ("failed", "rejected"):
        reason = result.code or result.message or status
        if reason == "preempted":
            return GoalOutcome.IGNORE, None
        if reason in RESEND_CODES:
            return GoalOutcome.RESEND, reason
        return GoalOutcome.FAILED, reason
    return GoalOutcome.IGNORE, None
