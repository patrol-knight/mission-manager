import asyncio
import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from config import Settings
from core.device_registry import DeviceRegistry
from core.goal_result import GoalOutcome, classify
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.camera import CommandResult
from models.device import DeviceView
from models.mission import Mission
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.investigation import InvestigationCoordinator

logger = logging.getLogger(__name__)


@dataclass
class _ActiveGoal:
    token: int
    robot_device_id: str
    target_waypoint_index: int
    request_id: str
    # state_machine has the goal (a "running" result).
    acknowledged: bool = False


class MissionDriveCoordinator:
    """Autonomously drives the current mission: sends the target waypoint
    (MissionExecutionState.target_waypoint_index) as a `navigate_to_goal`
    command, waits for its result (on_command_result()),
    advances MissionExecutionManager via record_waypoint_reached(), and sends
    the next one.

    Yields to the investigation: never sends a goal while the robot is
    investigating, and ignores arrivals reported meanwhile (they belong to the
    investigation) -- the two must never command the robot at once.

    advance() is the only entry point that starts something, and it's always
    safe to call speculatively: it re-checks every precondition (mission
    RUNNING, a connected robot, no investigation or goal in flight)
    and is a no-op if any fails."""

    def __init__(
        self,
        mission_execution_manager: MissionExecutionManager,
        mission_server: MissionServer,
        map_server: MapServer,
        device_registry: DeviceRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
        settings: Settings,
    ) -> None:
        self._mission_execution_manager = mission_execution_manager
        self._mission_server = mission_server
        self._map_server = map_server
        self._device_registry = device_registry
        self._zenoh_gateway = zenoh_gateway
        self._websocket_manager = websocket_manager
        self._settings = settings
        self._investigation: InvestigationCoordinator | None = None
        self._on_goal_failed: Callable[[str], None] | None = None

        self._lock = threading.RLock()
        self._active: _ActiveGoal | None = None
        # Robots to send cancel_navigation as soon as they report in again
        # (see cancel_on_reconnect()).
        self._cancel_on_reconnect: set[str] = set()
        self._next_token = 0

    def bind_investigation(self, investigation: "InvestigationCoordinator") -> None:
        """Late-bound: the investigation coordinator needs this class too
        (see bootstrap.py)."""
        self._investigation = investigation

    def bind_goal_failed(self, on_goal_failed: Callable[[str], None]) -> None:
        """Called with state_machine's reason when a waypoint goal fails."""
        self._on_goal_failed = on_goal_failed

    def _robot_is_investigating(self, device_id: str) -> bool:
        return self._investigation is not None and self._investigation.is_active_for(device_id)

    def rejoin(self) -> None:
        """The robot may have moved off its goal (an investigation, or the
        operator driving it with RC): retarget where it now is and drive there."""
        exec_state = self._mission_execution_manager.get_state()
        mission = self._mission_server.get_mission(exec_state.mission_id) if exec_state else None
        if mission is not None:
            index = self.join_index(mission, exec_state.target_waypoint_index or 0)
            if index is not None:
                self._mission_execution_manager.join_at(index)
        self.advance()

    def advance(self) -> None:
        if not self._settings.mission_drive_enabled:
            return

        with self._lock:
            if self._active is not None:
                return  # a goal is already in flight

            exec_state = self._mission_execution_manager.get_state()
            if exec_state is None or exec_state.status != MissionStatus.RUNNING:
                return
            next_index = exec_state.target_waypoint_index
            if next_index is None:
                return

            robot = self._device_registry.get_connected_robot()
            if robot is None or self._robot_is_investigating(robot.device_id):
                return

            mission = self._mission_server.get_mission(exec_state.mission_id)
            if mission is None or next_index >= len(mission.waypoints):
                return
            target = mission.waypoints[next_index]

            token = self._next_token = self._next_token + 1
            request_id = f"mission-{mission.mission_id}-wp{next_index}-{token}"
            self._active = _ActiveGoal(
                token=token,
                robot_device_id=robot.device_id,
                target_waypoint_index=next_index,
                request_id=request_id,
            )

        fields = {"x": target.x, "y": target.y, "frame_id": mission.frame_id}
        if target.yaw is not None:
            fields["yaw"] = target.yaw

        sent = self._zenoh_gateway.publish_command(
            robot.device_id,
            "navigate_to_goal",
            request_id=request_id,
            fields=fields,
        )
        if not sent:
            logger.warning("Mission drive: failed to publish navigate_to_goal for waypoint %s", target.waypoint_id)

        self._websocket_manager.run_coroutine_threadsafe(self._timeout_then_retry(token))
        logger.info(
            "Mission drive: robot %s heading to waypoint %s (index %d%s)",
            robot.device_id,
            target.waypoint_id,
            next_index,
            ", joining the route" if exec_state.joining else "",
        )

    def join_index(self, mission: Mission, toward: int = 0) -> int | None:
        """The waypoint the robot joins the mission at. On the route the
        operator sees: the end of the leg it's on, so Autoware drives that
        route (a leg is a shortest path, so is the rest of it), and waypoints
        passed meanwhile are skipped. Legs are searched from the one into
        `toward`, the current target, so the robot never skips ahead when the
        route runs a lanelet twice. Off the route: the closest waypoint by
        lanelet route length."""
        robot = self._device_registry.get_connected_robot()
        if robot is None or robot.pose is None or not self._map_server.is_available():
            return None
        fx, fy = robot.pose.x, robot.pose.y
        count = len(mission.waypoints)
        leg = self._map_server.leg_at(mission.loop_points(), fx, fy, first=(toward - 1) % count)
        if leg is not None:
            return (leg + 1) % count

        best: tuple[float, int] | None = None
        for index, waypoint in enumerate(mission.waypoints):
            route = self._map_server.get_route([{"x": fx, "y": fy}, {"x": waypoint.x, "y": waypoint.y}])
            if route is None:
                continue
            length = route["properties"]["length_m"]
            if best is None or length < best[0]:
                best = (length, index)
        return best[1] if best is not None else None

    def cancel_on_reconnect(self, device_id: str) -> None:
        """Autonomy was aborted while the robot was unreachable, so it may
        still be driving to its last goal. Stop it the moment it reports in
        again; the operator decides what it does next."""
        with self._lock:
            self._cancel_on_reconnect.add(device_id)

    def on_device_state(self, view: DeviceView) -> None:
        self._mission_execution_manager.refresh_readiness()
        with self._lock:
            cancel = view.connected and view.device_id in self._cancel_on_reconnect
            if cancel:
                self._cancel_on_reconnect.discard(view.device_id)
        if cancel:
            logger.info("Mission drive: robot %s is back; cancelling its last goal", view.device_id)
            self._zenoh_gateway.publish_command(
                view.device_id, "cancel_navigation", request_id=f"reconnect-{uuid.uuid4().hex[:8]}"
            )

    def on_command_result(self, result: CommandResult) -> None:
        if result.command != "navigate_to_goal":
            return
        outcome, reason = classify(result)
        with self._lock:
            active = self._active
            if active is None or active.request_id != result.request_id:
                return
            if outcome == GoalOutcome.RUNNING:
                active.acknowledged = True
                return
            if outcome == GoalOutcome.IGNORE:
                return
            self._active = None

        if outcome == GoalOutcome.ARRIVED:
            self._mission_execution_manager.record_waypoint_reached(active.target_waypoint_index)
            self.advance()
        elif outcome == GoalOutcome.RESEND:
            logger.warning("Mission drive: goal not taken (%s); sending it again", reason)
            self.advance()
        else:
            logger.warning("Mission drive: goal to waypoint index %d failed: %s", active.target_waypoint_index, reason)
            if self._on_goal_failed is not None:
                self._on_goal_failed(reason or "failed")

    async def _timeout_then_retry(self, token: int) -> None:
        await asyncio.sleep(self._settings.navigation_timeout_sec)
        with self._lock:
            if self._active is None or self._active.token != token or self._active.acknowledged:
                return
            self._active = None
        logger.warning("Mission drive: no answer to navigate_to_goal; sending it again")
        self.advance()

    def abort(self) -> None:
        """Call when the mission is paused/cancelled/switched, or an
        investigation is about to take over the robot -- clears any in-flight
        goal bookkeeping so a stale arrival can't advance a mission that's no
        longer running."""
        with self._lock:
            self._active = None
