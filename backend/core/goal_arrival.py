import logging
import math

from models.device import DeviceView

logger = logging.getLogger(__name__)

# "arrived" alone doesn't say arrived at WHAT -- DeviceState carries no goal
# id. A robot that never acted on a goal (it was rejected, lost, or superseded
# by a racing goal) keeps reporting "arrived" wherever it is, so an arrival
# only counts within this distance of the goal.
ARRIVAL_POSITION_TOLERANCE_M = 2.0


def arrived_at(view: DeviceView, target_x: float, target_y: float, issued_after_timestamp: float) -> bool:
    """Whether this device sample means the robot reached the goal at
    (target_x, target_y): it reports "arrived", the sample is newer than the
    moment the goal was sent (so a stale "arrived" from before doesn't count),
    and the robot is actually there. Shared by mission drive and the
    investigation coordinator."""
    if view.status.get("operational_state") != "arrived":
        return False
    if view.timestamp <= issued_after_timestamp:
        return False
    distance = math.hypot(view.pose.x - target_x, view.pose.y - target_y)
    if distance > ARRIVAL_POSITION_TOLERANCE_M:
        # Debug, not warning: a robot parked elsewhere reports this on every sample.
        logger.debug("Robot %s reports arrived %.1fm from its goal; not counted", view.device_id, distance)
        return False
    return True
