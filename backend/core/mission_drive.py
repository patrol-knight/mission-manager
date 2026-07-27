import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING

from config import Settings
from core.device_registry import DeviceRegistry
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.device import DeviceView
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.anomaly_response import AnomalyResponseCoordinator

logger = logging.getLogger(__name__)


@dataclass
class _ActiveGoal:
    token: int
    robot_device_id: str
    target_waypoint_index: int
    # The tracked robot's own DeviceState.timestamp at the moment this goal
    # was issued -- an "arrived" sample only completes this goal if its
    # timestamp is strictly newer. Without this, a stale "arrived" sample
    # left over from whatever the robot was doing *before* this goal (most
    # notably: the same sample that just made AnomalyResponseCoordinator
    # hand the robot back via advance(), re-processed by this coordinator
    # a moment later) would satisfy a goal that was never actually acted
    # on. The aggregator republishes at a fixed rate regardless of change,
    # so this timestamp is reliably strictly increasing.
    issued_after_timestamp: float


class MissionDriveCoordinator:
    """Autonomously drives the current mission: sends the next waypoint as
    a `navigate_to_goal` command (see ZenohGateway.publish_command), waits
    for the tracked robot's own reported arrival (on_device_state(), same
    signal AnomalyResponseCoordinator watches), advances
    MissionExecutionManager via record_waypoint_reached(), and sends the
    next one -- looping through the mission the same way DevSimulator used
    to before it was removed, except the robot now actually moves.

    Yields to AnomalyResponseCoordinator: never sends a goal while a
    diversion is active for the same robot, and ignores arrivals reported
    while one is (they belong to the diversion, not a mission waypoint) --
    the two must never command the robot at once.

    advance() is the only entry point that starts something, and it's
    always safe to call speculatively: it re-checks every precondition
    (mission RUNNING, a connected robot, no diversion/goal already in
    flight) and is a no-op if any fails. Call it after start()/resume()
    and whenever a diversion ends (see AnomalyResponseCoordinator).
    """

    def __init__(
        self,
        mission_execution_manager: MissionExecutionManager,
        mission_server: MissionServer,
        device_registry: DeviceRegistry,
        anomaly_response_coordinator: "AnomalyResponseCoordinator",
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
        settings: Settings,
    ) -> None:
        self._mission_execution_manager = mission_execution_manager
        self._mission_server = mission_server
        self._device_registry = device_registry
        self._anomaly_response_coordinator = anomaly_response_coordinator
        self._zenoh_gateway = zenoh_gateway
        self._websocket_manager = websocket_manager
        self._settings = settings

        self._lock = threading.RLock()
        self._active: _ActiveGoal | None = None
        self._next_token = 0

    def advance(self) -> None:
        if not self._settings.mission_drive_enabled:
            return

        with self._lock:
            if self._active is not None:
                return  # a goal is already in flight

            exec_state = self._mission_execution_manager.get_state()
            if exec_state is None or exec_state.status not in (MissionStatus.RUNNING, MissionStatus.RETURNING_HOME):
                return

            robot = self._device_registry.get_connected_robot()
            if robot is None:
                return
            if self._anomaly_response_coordinator.is_active_for(robot.device_id):
                return  # anomaly diversion owns the robot right now

            mission = self._mission_server.get_mission(exec_state.mission_id)
            if mission is None or not mission.waypoints:
                return

            # RETURNING_HOME (after Stop) always heads for waypoint 0 --
            # record_waypoint_reached(0) is what resets it straight to READY
            # (not COMPLETED -- that's reserved for finishing all configured
            # loops naturally, see mission_execution.py::_finish_mission).
            next_index = (
                0
                if exec_state.status == MissionStatus.RETURNING_HOME
                else (exec_state.current_waypoint_index + 1) % len(mission.waypoints)
            )
            target = mission.waypoints[next_index]

            token = self._next_token = self._next_token + 1
            self._active = _ActiveGoal(
                token=token,
                robot_device_id=robot.device_id,
                target_waypoint_index=next_index,
                issued_after_timestamp=robot.timestamp,
            )

        fields = {"x": target.x, "y": target.y, "frame_id": mission.frame_id}
        if target.yaw is not None:
            fields["yaw"] = target.yaw

        sent = self._zenoh_gateway.publish_command(
            robot.device_id, "navigate_to_goal",
            request_id=f"mission-{mission.mission_id}-wp{next_index}-{token}",
            fields=fields,
        )
        if not sent:
            logger.warning("Mission drive: failed to publish navigate_to_goal for waypoint %s", target.waypoint_id)

        self._websocket_manager.run_coroutine_threadsafe(self._timeout_then_retry(token))
        logger.info(
            "Mission drive: robot %s heading to waypoint %s (index %d)",
            robot.device_id, target.waypoint_id, next_index,
        )

    def on_device_state(self, view: DeviceView) -> None:
        if self._anomaly_response_coordinator.is_active_for(view.device_id):
            return  # this arrival belongs to an active diversion, not us

        with self._lock:
            active = self._active
            if active is None or active.robot_device_id != view.device_id:
                return
            if view.status.get("operational_state") != "arrived":
                return
            if view.timestamp <= active.issued_after_timestamp:
                return  # stale sample from before this goal was issued
            waypoint_index = active.target_waypoint_index
            self._active = None

        self._mission_execution_manager.record_waypoint_reached(waypoint_index)
        self.advance()

    async def _timeout_then_retry(self, token: int) -> None:
        await asyncio.sleep(self._settings.navigation_timeout_sec)
        with self._lock:
            if self._active is None or self._active.token != token:
                return  # already arrived, or superseded
            self._active = None
        logger.warning("Mission drive: navigate_to_goal timed out; retrying")
        self.advance()

    def abort(self) -> None:
        """Call when the mission is paused/stopped/switched, or a
        diversion is about to take over the robot -- clears any in-flight
        goal bookkeeping so a stale arrival can't advance a mission that's
        no longer running, or race with the diversion."""
        with self._lock:
            self._active = None
