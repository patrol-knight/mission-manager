import logging
import math
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.anomaly import Anomaly, AnomalyStatus
from models.anomaly_response import DiversionPhase, DiversionReturning, DiversionStarted
from models.device import DeviceView
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)


@dataclass
class _ActiveDiversion:
    token: int
    anomaly_id: str
    robot_device_id: str
    phase: DiversionPhase
    anomaly_target_xy: tuple[float, float]
    target_waypoint_id: str
    target_waypoint_xy: tuple[float, float]
    started_payload: dict
    # The tracked robot's own DeviceState.timestamp at the moment the
    # current leg's navigate_to_goal was issued -- an "arrived" sample only
    # completes this leg if its timestamp is strictly newer. Same fix as
    # MissionDriveCoordinator._ActiveGoal.issued_after_timestamp, and for
    # the identical reason: without this, a stale "arrived" sample left
    # over from whatever the robot was doing *before* this leg started
    # (most notably: finishing a mission waypoint at the same moment this
    # diversion begins, or reaching the anomaly right as the return leg
    # begins) satisfies a goal that was never actually acted on --
    # silently advancing this phase past OUTBOUND/RETURNING before the
    # robot has moved at all, so the real arrival later is never recognized.
    issued_after_timestamp: float
    returning_payload: dict | None = None


# "arrived" alone doesn't say arrived at WHAT -- DeviceState carries no
# goal/request-id to correlate against. If MissionDriveCoordinator's "go to
# the next waypoint" command physically races with this diversion's own "go
# to the anomaly" command (both can be in flight within the same instant --
# see abort()'s call site in on_anomaly_detected), whichever reaches the
# robot last wins, and the robot can genuinely, freshly arrive at the WRONG
# place. issued_after_timestamp alone can't catch that (the sample is
# legitimately new, just for a different goal), so on_device_state also
# checks the robot's reported position against this leg's actual target.
ARRIVAL_POSITION_TOLERANCE_M = 2.0


class AnomalyResponseCoordinator:
    """Drives the anomaly -> robot-diverts -> operator-resolves -> robot-
    returns workflow. Single active diversion at a time, same "one current
    mission" precedent as MissionExecutionManager -- a second anomaly while
    one is in flight is still recorded (visible on the map) but doesn't
    trigger a new diversion (known limitation, not a bug).

    Sends the robot a `navigate_to_goal` command (see ZenohGateway.
    publish_command) for both the outbound (to the anomaly) and return
    (back to the mission) legs, then waits for the tracked robot's own
    reported arrival (DeviceState.status.operational_state == "arrived",
    delivered via on_device_state()) -- the robot (dummy_robot today, a
    real onboard nav stack later) plans its own path there, this class
    never computes or sends one. There is deliberately no timeout on this
    wait (a diversion can legitimately take a while) -- the only automatic
    way out is `abort_if_robot_disconnected()`; the manual way out is
    Stop, which `MissionExecutionManager.stop()` allows even mid-diversion
    specifically as an escape hatch (see core/mission_execution.py).

    Almost everything here is synchronous and RLock-protected, callable
    from any thread (Zenoh's subscriber thread or a FastAPI sync-route
    thread-pool thread) -- exactly like MissionExecutionManager.

    Orchestration mostly happens at the call site (zenoh_gateway's ingest,
    api/anomaly.py's verify/dismiss, api/mission.py's/api/mission_execution.py's
    abort triggers), matching this codebase's existing convention (see
    api/mission.py) -- but this class DOES mutate MissionExecutionManager
    in one specific way: entering/exiting the INVESTIGATING status, via
    enter_investigating()/exit_investigating(). That status has to be
    genuinely authoritative (it's what blocks Pause/Resume/Stop-as-normal
    during a diversion), so it can't just be inferred by reading state --
    something has to own setting it, and this is the only thing that knows
    when a diversion starts/ends. MissionDriveCoordinator, bound late via
    bind_mission_drive() (same construction-order reason as ZenohGateway.
    bind_coordinators()), is paused/resumed the same way for the same
    reason: the two must never command the robot at once.
    """

    def __init__(
        self,
        anomaly_registry: AnomalyRegistry,
        mission_execution_manager: MissionExecutionManager,
        mission_server: MissionServer,
        map_server: MapServer,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
        zenoh_gateway: ZenohGateway,
        settings: Settings,
    ) -> None:
        self._anomaly_registry = anomaly_registry
        self._mission_execution_manager = mission_execution_manager
        self._mission_server = mission_server
        self._map_server = map_server
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._zenoh_gateway = zenoh_gateway
        self._settings = settings
        self._mission_drive_coordinator: "MissionDriveCoordinator | None" = None

        self._lock = threading.RLock()
        self._active: _ActiveDiversion | None = None
        self._next_token = 0

    def bind_mission_drive(self, mission_drive_coordinator: "MissionDriveCoordinator") -> None:
        self._mission_drive_coordinator = mission_drive_coordinator

    def is_active_for(self, device_id: str) -> bool:
        """For MissionDriveCoordinator: is a diversion currently commanding
        this robot? While true, mission-driven waypoint goals must not be
        sent, and any arrival report for it belongs to this diversion, not
        a mission waypoint."""
        with self._lock:
            return self._active is not None and self._active.robot_device_id == device_id

    def on_anomaly_detected(self, anomaly: Anomaly) -> None:
        """Call once per newly-created anomaly (not on re-published updates
        to an already-known one) -- see zenoh_gateway.py's is_new gate."""
        if not self._settings.anomaly_response_enabled:
            return

        with self._lock:
            if self._active is not None:
                logger.info(
                    "Anomaly %s detected while already responding to %s; ignoring",
                    anomaly.anomaly_id, self._active.anomaly_id,
                )
                return

            exec_state = self._mission_execution_manager.get_state()
            if exec_state is None or exec_state.status != MissionStatus.RUNNING:
                logger.info("Anomaly %s detected but no RUNNING mission; not diverting", anomaly.anomaly_id)
                return

            robot = self._device_registry.get_connected_robot()
            if robot is None:
                logger.info("Anomaly %s detected but no connected robot; not diverting", anomaly.anomaly_id)
                return

            mission = self._mission_server.get_mission(exec_state.mission_id)
            if mission is None or not mission.waypoints:
                logger.info(
                    "Anomaly %s detected but current mission has no waypoints; not diverting", anomaly.anomaly_id
                )
                return
            # current_waypoint_index tracks the LAST-REACHED waypoint (see
            # MissionExecutionManager.record_waypoint_reached) -- the next
            # target is the following one, wrapping around the loop.
            target_wp = mission.waypoints[(exec_state.current_waypoint_index + 1) % len(mission.waypoints)]

            if not self._map_server.is_available():
                logger.info("Anomaly %s detected but map service unavailable; not diverting", anomaly.anomaly_id)
                return

            target_point = self._map_server.snap_to_lanelet(anomaly.x, anomaly.y, anomaly.frame_id)
            route = self._map_server.get_route(
                [{"x": robot.pose.x, "y": robot.pose.y}, {"x": target_point.x, "y": target_point.y}]
            )
            if route is None:
                logger.info(
                    "Anomaly %s detected but no route from robot to anomaly; not diverting", anomaly.anomaly_id
                )
                return

            # Authoritative commit gate, re-checked as late as possible: the
            # map/route lookups just above don't hold this lock, so a
            # pause()/stop() could have landed in the meantime and already
            # moved the mission off RUNNING. enter_investigating() re-checks
            # status atomically under MissionExecutionManager's own lock and
            # returns None if it's no longer RUNNING -- if so, back out
            # entirely rather than starting a diversion against a mission
            # that isn't running anymore.
            if self._mission_execution_manager.enter_investigating() is None:
                logger.info(
                    "Anomaly %s: mission status changed before diversion could start; not diverting",
                    anomaly.anomaly_id,
                )
                return

            token = self._next_token = self._next_token + 1
            started = DiversionStarted(
                anomaly_id=anomaly.anomaly_id,
                robot_device_id=robot.device_id,
                route=route,
                target=target_point,
                started_at=datetime.now(timezone.utc),
            )
            started_payload = started.model_dump(mode="json")
            self._active = _ActiveDiversion(
                token=token,
                anomaly_id=anomaly.anomaly_id,
                robot_device_id=robot.device_id,
                phase=DiversionPhase.OUTBOUND,
                anomaly_target_xy=(target_point.x, target_point.y),
                target_waypoint_id=target_wp.waypoint_id,
                target_waypoint_xy=(target_wp.x, target_wp.y),
                started_payload=started_payload,
                issued_after_timestamp=robot.timestamp,
            )

        # This diversion now owns the robot -- release any mission-driven
        # waypoint goal in flight (it was just physically superseded by the
        # navigate_to_goal command below, but MissionDriveCoordinator's own
        # bookkeeping doesn't know that yet).
        if self._mission_drive_coordinator is not None:
            self._mission_drive_coordinator.abort()

        self._anomaly_registry.record_mission_context(anomaly.anomaly_id, exec_state.mission_id)
        updated = self._anomaly_registry.update_status(anomaly.anomaly_id, AnomalyStatus.ROBOT_EN_ROUTE)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
        )
        self._websocket_manager.broadcast_threadsafe({"type": "anomaly.diversion.started", "data": started_payload})

        sent = self._zenoh_gateway.publish_command(
            robot.device_id, "navigate_to_goal",
            request_id=f"anomaly-{anomaly.anomaly_id}-outbound-{token}",
            fields={"x": target_point.x, "y": target_point.y, "frame_id": target_point.frame_id},
        )
        if not sent:
            logger.warning("Anomaly %s: failed to publish navigate_to_goal command", anomaly.anomaly_id)

        logger.info("Anomaly %s: robot %s diverting", anomaly.anomaly_id, robot.device_id)

    def on_device_state(self, view: DeviceView) -> None:
        """Called by ZenohGateway for every meaningfully-changed device
        state -- a cheap no-op unless this device is the one an active
        diversion is waiting on."""
        with self._lock:
            active = self._active
            if active is None or active.robot_device_id != view.device_id:
                return
            if view.status.get("operational_state") != "arrived":
                return
            if view.timestamp <= active.issued_after_timestamp:
                return  # stale sample from before this leg's goal was issued
            phase = active.phase
            # AWAITING_RESOLUTION has no active navigation goal at all -- the
            # robot is just parked at the anomaly waiting on the operator, so
            # there's nothing to position-check here (and no reason for
            # on_device_state to do anything else either; the dispatch below
            # only acts on OUTBOUND/RETURNING).
            if phase in (DiversionPhase.OUTBOUND, DiversionPhase.RETURNING):
                target_x, target_y = (
                    active.anomaly_target_xy if phase == DiversionPhase.OUTBOUND else active.target_waypoint_xy
                )
                distance = math.hypot(view.pose.x - target_x, view.pose.y - target_y)
                if distance > ARRIVAL_POSITION_TOLERANCE_M:
                    # Genuinely new "arrived" sample, but not at this leg's
                    # target -- most likely a mission-drive goal that raced
                    # with this diversion's own command and reached the
                    # robot last (see abort()'s call site in
                    # on_anomaly_detected). Not this leg's arrival; ignore.
                    logger.warning(
                        "Anomaly %s: robot reported arrived %.1fm from expected %s target; ignoring",
                        active.anomaly_id, distance, phase.value,
                    )
                    return
            token = active.token
            anomaly_id = active.anomaly_id

        if phase == DiversionPhase.OUTBOUND:
            self._complete_arrival(token, anomaly_id)
        elif phase == DiversionPhase.RETURNING:
            self._complete_return(token, anomaly_id)

    def _complete_arrival(self, token: int, anomaly_id: str) -> None:
        with self._lock:
            if self._active is None or self._active.token != token or self._active.phase != DiversionPhase.OUTBOUND:
                return  # already handled or superseded
            self._active.phase = DiversionPhase.AWAITING_RESOLUTION

        updated = self._anomaly_registry.update_status(anomaly_id, AnomalyStatus.ROBOT_ARRIVED)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
        )
        # No separate diversion event here -- AnomalyArrivalWatcher already
        # reacts to anomaly.updated's robot_arrived status.
        logger.info("Anomaly %s: robot arrived, awaiting operator resolution", anomaly_id)

    def _complete_return(self, token: int, anomaly_id: str) -> None:
        with self._lock:
            if self._active is None or self._active.token != token or self._active.phase != DiversionPhase.RETURNING:
                return
            self._active = None
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": "return_complete"}}
        )
        logger.info("Anomaly %s: diversion cleared (return_complete)", anomaly_id)
        self._end_diversion()

    def resolve(self, anomaly_id: str) -> None:
        """Call after verify() or dismiss() succeeds -- both resolve an
        anomaly identically (see anomaly_registry._resolve's docstring)."""
        with self._lock:
            active = self._active
            if active is None or active.anomaly_id != anomaly_id or active.phase != DiversionPhase.AWAITING_RESOLUTION:
                logger.info("Anomaly %s resolved but no matching in-flight diversion; no-op", anomaly_id)
                return

            route = None
            if self._map_server.is_available():
                tx, ty = active.anomaly_target_xy
                wx, wy = active.target_waypoint_xy
                route = self._map_server.get_route([{"x": tx, "y": ty}, {"x": wx, "y": wy}])

            if route is None:
                self._active = None
            else:
                returning = DiversionReturning(
                    anomaly_id=anomaly_id,
                    robot_device_id=active.robot_device_id,
                    route=route,
                    target_waypoint_id=active.target_waypoint_id,
                    started_at=datetime.now(timezone.utc),
                )
                returning_payload = returning.model_dump(mode="json")
                active.phase = DiversionPhase.RETURNING
                active.returning_payload = returning_payload
                # Same staleness guard as the outbound leg (see
                # _ActiveDiversion.issued_after_timestamp) -- otherwise a
                # stale "arrived" sample left over from reaching the
                # anomaly (the outbound leg's own destination) would
                # immediately satisfy the return leg too, before the robot
                # has moved at all.
                current_view = self._device_registry.get(active.robot_device_id)
                if current_view is not None:
                    active.issued_after_timestamp = current_view.timestamp
                token = active.token
                robot_device_id = active.robot_device_id
                wx, wy = active.target_waypoint_xy

        if route is None:
            self._websocket_manager.broadcast_threadsafe(
                {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": "return_route_unavailable"}}
            )
            logger.info("Anomaly %s resolved but no return route available; cleared without a return leg", anomaly_id)
            self._end_diversion()
            return

        self._websocket_manager.broadcast_threadsafe({"type": "anomaly.diversion.returning", "data": returning_payload})

        sent = self._zenoh_gateway.publish_command(
            robot_device_id, "navigate_to_goal",
            request_id=f"anomaly-{anomaly_id}-return-{token}",
            fields={"x": wx, "y": wy, "frame_id": "map"},
        )
        if not sent:
            logger.warning("Anomaly %s: failed to publish return-leg navigate_to_goal command", anomaly_id)

        logger.info("Anomaly %s: robot returning to mission", anomaly_id)

    def abort_if_active(self, reason: str) -> None:
        """Called from the API layer when something makes an in-flight
        diversion's frozen state stale: mission stopped (the escape hatch --
        see MissionExecutionManager.stop()) or the robot disconnected (see
        abort_if_robot_disconnected below). Reverts the anomaly to DETECTED
        if the robot hadn't reached it yet (so it isn't stuck at
        ROBOT_EN_ROUTE with no path to resolution); leaves it ROBOT_ARRIVED
        otherwise, since it's still independently verifiable/dismissable
        via REST regardless of whether this coordinator is still tracking
        it."""
        with self._lock:
            active = self._active
            if active is None:
                return
            anomaly_id = active.anomaly_id
            phase = active.phase
            self._active = None

        if phase == DiversionPhase.OUTBOUND:
            updated = self._anomaly_registry.update_status(anomaly_id, AnomalyStatus.DETECTED)
            self._websocket_manager.broadcast_threadsafe(
                {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
            )

        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.diversion.cleared", "data": {"anomaly_id": anomaly_id, "reason": reason}}
        )
        logger.info("Anomaly %s: diversion aborted (%s)", anomaly_id, reason)
        self._end_diversion()

    def abort_if_robot_disconnected(self) -> None:
        """Call once per DeviceRegistry offline-monitor tick (app.py) --
        cheap no-op unless a diversion is actually active."""
        with self._lock:
            active = self._active
            if active is None:
                return
            robot_device_id = active.robot_device_id

        device = self._device_registry.get(robot_device_id)
        if device is None or not device.connected:
            self.abort_if_active("robot_disconnected")

    def _end_diversion(self) -> None:
        """A diversion just ended/aborted -- restore normal mission status
        (INVESTIGATING -> RUNNING) and let mission-driven waypoint goals
        resume. Both steps re-check their own preconditions and no-op
        harmlessly if there's nothing to do (e.g. Stop already moved status
        past INVESTIGATING directly to RETURNING_HOME), so it's always safe
        to call this from every diversion-ending path."""
        self._mission_execution_manager.exit_investigating()
        if self._mission_drive_coordinator is not None:
            self._mission_drive_coordinator.advance()

    def get_active(self) -> tuple[str, dict] | None:
        """For WebSocket-reconnect resend (api/websocket.py): the last
        broadcast diversion event, if one is in flight."""
        with self._lock:
            active = self._active
            if active is None:
                return None
            if active.phase == DiversionPhase.RETURNING and active.returning_payload is not None:
                return "anomaly.diversion.returning", active.returning_payload
            return "anomaly.diversion.started", active.started_payload
