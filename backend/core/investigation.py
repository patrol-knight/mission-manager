import logging
import math
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import (
    AlreadyOnSiteError,
    AnomalyNotFoundError,
    InvalidAnomalyTransitionError,
    MapUnavailableError,
    NoActiveInvestigationError,
    NoConnectedRobotError,
    NoRouteError,
    NotOnSiteError,
    NoVerdictError,
    RobotNotReadyError,
    VerdictRequiredError,
)
from core.goal_result import GoalOutcome, classify
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.websocket_manager import WebSocketManager
from models.anomaly import FINAL_VERDICTS, AnomalyVerdict
from models.camera import CommandResult
from models.device import DeviceView
from models.investigation import ExplorePreview, InvestigationKind, InvestigationPhase, InvestigationState
from models.map import MapPoint
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)

# A goal this close by route is where the robot already is.
ALREADY_THERE_M = 0.5
# How far the robot's cameras see an anomaly well enough to verify it.
VIEW_RANGE_M = 4.0


@dataclass(frozen=True)
class _Goal:
    """Where the robot is sent, and its route there."""

    target: MapPoint
    yaw: float | None
    route: dict
    length_m: float


class InvestigationCoordinator:
    """The operator-driven investigate mode (README "Mission & Investigation
    State Machines"): NONE -> EN_ROUTE -> ON_SITE -> NONE, in parallel with
    the mission and taking priority over it -- while an investigation is
    active, mission drive sends no goals and MissionService refuses mission
    transitions.

    Three kinds: ANOMALY ends with a verdict; CAMERA (a camera_unhealthy
    anomaly: the robot goes to look in the tower's place) and EXPLORE (a point
    the operator picked) end when the operator dismisses them. Only an
    ANOMALY on site without a verdict holds the robot; the others may be
    taken over at any time.

    - start() / explore(): send the robot, or switch it to another target.
    - on_command_result(): EN_ROUTE -> ON_SITE when the goal succeeds.
    - on_device_state(): EN_ROUTE -> ON_SITE when blocked close to the goal.
    - set_verdict(): the operator's draft verdict while ON_SITE (ANOMALY).
    - cancel() / finish(): leave investigate mode and hand the robot back to
      the mission (MissionExecutionManager.after_investigation()).

    An anomaly's verdict is committed only when the robot leaves it, and the
    robot can't switch to another anomaly from ON_SITE until one is chosen
    (VerdictRequiredError).

    State changes happen under the lock; registry writes, broadcasts and robot
    commands happen after it is released, so a slow socket never blocks the
    Zenoh thread that reports arrivals."""

    def __init__(
        self,
        anomaly_registry: AnomalyRegistry,
        mission_execution_manager: MissionExecutionManager,
        map_server: MapServer,
        device_registry: DeviceRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
        settings: Settings,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._anomalies = anomaly_registry
        self._execution = mission_execution_manager
        self._map = map_server
        self._devices = device_registry
        self._gateway = zenoh_gateway
        self._websocket = websocket_manager
        self._settings = settings
        self._clock = clock
        self._drive: MissionDriveCoordinator | None = None

        self._lock = threading.RLock()
        self._state: InvestigationState | None = None
        self._request_id: str | None = None
        self._goal_count = 0
        # When the robot started reporting `blocked` near the goal.
        self._blocked_since: float | None = None
        self._on_goal_failed: Callable[[str], None] | None = None

    def bind_mission_drive(self, mission_drive: "MissionDriveCoordinator") -> None:
        """Late-bound: mission drive needs this class too (see bootstrap.py)."""
        self._drive = mission_drive

    def bind_goal_failed(self, on_goal_failed: Callable[[str], None]) -> None:
        """Called with state_machine's reason when the investigation's goal fails."""
        self._on_goal_failed = on_goal_failed

    # -- Queries ---------------------------------------------------------------

    def get_state(self) -> InvestigationState | None:
        with self._lock:
            return self._state.model_copy(deep=True) if self._state else None

    def is_active(self) -> bool:
        with self._lock:
            return self._state is not None

    def is_active_for(self, device_id: str) -> bool:
        with self._lock:
            return self._state is not None and self._state.robot_device_id == device_id

    def preview_explore(self, lat: float, lon: float) -> ExplorePreview:
        """Where Explore would stop to look at a point, from where the robot is now."""
        robot = self._require_robot()
        look_at = self._point_at_latlon(lat, lon)
        view = self._goal(robot, look_at.x, look_at.y)
        return ExplorePreview(look_at=look_at, target=view.target, length_m=view.length_m)

    # -- Commands ----------------------------------------------------------------

    def start(self, anomaly_id: str) -> InvestigationState:
        """Sends the robot to an anomaly, or switches it to another one. An
        EN_ROUTE anomaly is abandoned (no verdict), an ON_SITE one has its
        verdict committed -- which requires one to be chosen. A camera check
        or Explore is simply taken over."""
        robot = self._require_robot()
        anomaly = self._anomalies.get(anomaly_id)
        if anomaly is None:
            raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
        if anomaly.is_closed:
            raise InvalidAnomalyTransitionError(f"Anomaly already resolved: {anomaly_id}")
        look_at = self._point_at_xy(anomaly.x, anomaly.y, anomaly.frame_id)
        view = self._goal(robot, anomaly.x, anomaly.y)

        with self._lock:
            previous = self._state
            if previous is not None and previous.anomaly_id == anomaly_id:
                return previous.model_copy(deep=True)
            if _awaits_verdict(previous):
                raise VerdictRequiredError("Verify the current anomaly first")
            # Atomic with expiry: the anomaly may have expired since get().
            if self._anomalies.set_target(anomaly_id) is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            kind = InvestigationKind.CAMERA if anomaly.is_camera_unhealthy else InvestigationKind.ANOMALY
            state = self._begin(kind, anomaly_id, robot, look_at, view)
            request_id = self._request_id

        self._dispatch(previous, state, request_id)
        logger.info("Investigation: robot %s heading to anomaly %s", robot.device_id, anomaly_id)
        return state

    def explore(self, lat: float, lon: float) -> InvestigationState:
        """Explore: sends the robot to look at a point, or retargets it. Like
        switching anomalies: an ON_SITE anomaly needs its verdict first (and
        has it committed), anything else is taken over."""
        robot = self._require_robot()
        look_at = self._point_at_latlon(lat, lon)
        view = self._goal(robot, look_at.x, look_at.y)

        with self._lock:
            previous = self._state
            if _awaits_verdict(previous):
                raise VerdictRequiredError("Verify the current anomaly first")
            if previous is not None and previous.anomaly_id is not None:
                self._anomalies.set_target(None)
            state = self._begin(InvestigationKind.EXPLORE, None, robot, look_at, view)
            request_id = self._request_id

        self._dispatch(previous, state, request_id)
        logger.info("Explore: robot %s heading to look at (%.1f, %.1f)", robot.device_id, look_at.x, look_at.y)
        return state

    def set_verdict(self, verdict: AnomalyVerdict) -> InvestigationState:
        with self._lock:
            if self._state is None:
                raise NoActiveInvestigationError("The robot is not investigating")
            if self._state.kind != InvestigationKind.ANOMALY:
                raise NoVerdictError(f"{_describe(self._state)} has no verdict")
            if self._state.phase != InvestigationPhase.ON_SITE:
                raise NotOnSiteError("The robot hasn't reached the anomaly yet")
            self._state = self._state.model_copy(update={"draft_verdict": verdict})
            state = self._state.model_copy(deep=True)
        self._broadcast_state()
        return state

    def cancel(self) -> None:
        self._end(InvestigationPhase.EN_ROUTE)

    def finish(self) -> None:
        self._end(InvestigationPhase.ON_SITE)

    def _end(self, phase: InvestigationPhase) -> None:
        """A camera check or Explore ends from either phase; an anomaly only from `phase`."""
        with self._lock:
            previous = self._state
            if previous is None:
                raise NoActiveInvestigationError("The robot is not investigating")
            anomaly = previous.kind == InvestigationKind.ANOMALY
            if anomaly and previous.phase != phase:
                if phase == InvestigationPhase.EN_ROUTE:
                    raise AlreadyOnSiteError("The robot is on site: finish with a verdict instead")
                raise NotOnSiteError("The robot hasn't reached the anomaly yet")
            if anomaly and phase == InvestigationPhase.ON_SITE and previous.draft_verdict is None:
                raise VerdictRequiredError("Verify the current anomaly first")
            self._state = None
            self._blocked_since = None
            if previous.anomaly_id is not None:
                self._anomalies.set_target(None)

        if anomaly and phase == InvestigationPhase.ON_SITE:
            self._commit(previous)
        self._broadcast_state()
        logger.info("%s ended (%s)", _describe(previous), previous.phase.value)
        self._hand_back(previous.robot_device_id)

    # -- Robot events --------------------------------------------------------------

    def on_command_result(self, result: CommandResult) -> None:
        """The result of the investigation's goal: arrival puts the robot ON_SITE."""
        if result.command != "navigate_to_goal":
            return
        outcome, reason = classify(result)
        if outcome not in (GoalOutcome.ARRIVED, GoalOutcome.RESEND, GoalOutcome.FAILED):
            return
        with self._lock:
            state = self._state
            if state is None or state.phase != InvestigationPhase.EN_ROUTE or result.request_id != self._request_id:
                return
            if outcome == GoalOutcome.ARRIVED:
                state = self._arrive()
        if outcome == GoalOutcome.ARRIVED:
            self._after_arrival(state)
            logger.info("%s: robot arrived", _describe(state))
        elif outcome == GoalOutcome.RESEND:
            logger.warning("%s: goal not taken (%s); sending it again", _describe(state), reason)
            self._send_goal(state, result.request_id)
        else:
            logger.warning("%s: goal failed: %s", _describe(state), reason)
            if self._on_goal_failed is not None:
                self._on_goal_failed(reason or "failed")

    def on_device_state(self, view: DeviceView) -> None:
        """A robot blocked close to its goal counts as arrived: state_machine
        pauses its not_moving timer while blocked, so the goal would never end
        on its own -- typically the subject itself, lying on the lane."""
        with self._lock:
            state = self._state
            if state is None or view.device_id != state.robot_device_id:
                return
            if state.phase != InvestigationPhase.EN_ROUTE or not self._blocked_near_goal(view, state):
                self._blocked_since = None
                return
            now = self._clock()
            if self._blocked_since is None:
                self._blocked_since = now
                return
            if now - self._blocked_since < self._settings.arrive_blocked_after_sec:
                return
            state = self._arrive()
        self._after_arrival(state)
        self._gateway.publish_command(
            state.robot_device_id, "cancel_navigation", request_id=f"investigate-blocked-{uuid.uuid4().hex[:8]}"
        )
        logger.info("%s: robot blocked near the goal, counted as arrived", _describe(state))

    def abort(self) -> InvestigationState | None:
        """Ends the investigation without a verdict and without handing the
        robot back to the mission -- for when autonomy is aborted altogether
        (MissionService.abort_autonomy). Returns what was cancelled, if
        anything."""
        with self._lock:
            state = self._state
            if state is None:
                return None
            self._state = None
            self._blocked_since = None
            if state.anomaly_id is not None:
                self._anomalies.set_target(None)
        self._broadcast_state()
        logger.warning("%s cancelled", _describe(state))
        return state

    # -- Internals -------------------------------------------------------------------

    def _require_robot(self) -> DeviceView:
        robot = self._devices.get_connected_robot()
        if robot is None:
            raise NoConnectedRobotError("The robot is not connected")
        if not self._map.is_available():
            raise MapUnavailableError("Map service is unavailable: cannot route the robot")
        if robot.pose is None:
            raise RobotNotReadyError("The robot is not localized")
        return robot

    def _goal(self, robot: DeviceView, x: float, y: float) -> _Goal:
        """The shortest drive to a place that sees (x, y) (MapServer.viewpoints):
        a lane a U-turn away loses to one passing within view, and a subject
        lying on the lane is seen from before it rather than driven into.
        Otherwise (none, or visible_stop off) its nearest lanelet point."""
        if self._settings.visible_stop:
            best: _Goal | None = None
            for point, yaw in self._map.viewpoints(x, y, VIEW_RANGE_M, (robot.pose.x, robot.pose.y)):
                route = self._map.get_route([{"x": robot.pose.x, "y": robot.pose.y}, {"x": point.x, "y": point.y}])
                if route is not None and (best is None or route["properties"]["length_m"] < best.length_m):
                    best = _Goal(target=point, yaw=yaw, route=route, length_m=route["properties"]["length_m"])
            if best is not None:
                return best
        target = self._map.snap_to_lanelet(x, y)
        route = self._map.get_route([{"x": robot.pose.x, "y": robot.pose.y}, {"x": target.x, "y": target.y}])
        if route is None:
            raise NoRouteError("No route from the robot to this point")
        return _Goal(
            target=target,
            yaw=self._map.lane_yaw(target.x, target.y),
            route=route,
            length_m=route["properties"]["length_m"],
        )

    def _point_at_xy(self, x: float, y: float, frame_id: str = "map") -> MapPoint:
        at = self._map.xy_to_latlon(x, y, frame_id)
        return MapPoint(x=x, y=y, frame_id=frame_id, lat=at.lat, lon=at.lon)

    def _point_at_latlon(self, lat: float, lon: float) -> MapPoint:
        xy = self._map.latlon_to_xy(lat, lon)
        return MapPoint(x=xy.x, y=xy.y, frame_id=xy.frame_id, lat=lat, lon=lon)

    def _begin(
        self,
        kind: InvestigationKind,
        anomaly_id: str | None,
        robot: DeviceView,
        look_at: MapPoint,
        view: _Goal,
    ) -> InvestigationState:
        """Replaces the state with a new target. Call under the lock. A
        goal where the robot already is starts ON_SITE."""
        now = datetime.now(timezone.utc)
        there = view.length_m < ALREADY_THERE_M
        self._goal_count += 1
        self._request_id = f"investigate-{anomaly_id or 'explore'}-{self._goal_count}"
        self._blocked_since = None
        self._state = InvestigationState(
            kind=kind,
            anomaly_id=anomaly_id,
            robot_device_id=robot.device_id,
            phase=InvestigationPhase.ON_SITE if there else InvestigationPhase.EN_ROUTE,
            look_at=look_at,
            target=view.target,
            target_yaw=view.yaw,
            route=view.route,
            started_at=now,
            arrived_at=now if there else None,
        )
        return self._state.model_copy(deep=True)

    def _dispatch(self, previous: InvestigationState | None, state: InvestigationState, request_id: str) -> None:
        """After _begin(): settle the previous target, then send the robot."""
        if previous is None:
            # The investigation now owns the robot: drop mission drive's
            # in-flight waypoint goal (the command below supersedes it) and
            # any dwell it was holding.
            if self._drive is not None:
                self._drive.abort()
            self._execution.drop_dwell()
        elif previous.kind == InvestigationKind.ANOMALY and previous.draft_verdict is not None:
            self._commit(previous)

        self._broadcast_state()
        if state.phase == InvestigationPhase.ON_SITE:
            self._after_arrival(state, broadcast=False)
            self._gateway.publish_command(
                state.robot_device_id, "cancel_navigation", request_id=f"investigate-here-{uuid.uuid4().hex[:8]}"
            )
        else:
            self._send_goal(state, request_id)

    def _send_goal(self, state: InvestigationState, request_id: str) -> None:
        fields = {"x": state.target.x, "y": state.target.y, "frame_id": state.target.frame_id}
        if state.target_yaw is not None:
            fields["yaw"] = state.target_yaw
        self._gateway.publish_command(state.robot_device_id, "navigate_to_goal", request_id=request_id, fields=fields)

    def _blocked_near_goal(self, view: DeviceView, state: InvestigationState) -> bool:
        """Blocked within driving distance of the goal: a robot on the
        opposite lane, a U-turn away, isn't close however near it looks."""
        if view.state != "blocked" or view.pose is None:
            return False
        within = self._settings.arrive_blocked_within_m
        # The drive is never shorter than the straight line: route only when it can count.
        if math.hypot(view.pose.x - state.target.x, view.pose.y - state.target.y) > within:
            return False
        route = self._map.get_route([{"x": view.pose.x, "y": view.pose.y}, {"x": state.target.x, "y": state.target.y}])
        return route is not None and route["properties"]["length_m"] <= within

    def _arrive(self) -> InvestigationState:
        """EN_ROUTE -> ON_SITE. Call under the lock."""
        now = datetime.now(timezone.utc)
        self._blocked_since = None
        self._state = self._state.model_copy(update={"phase": InvestigationPhase.ON_SITE, "arrived_at": now})
        return self._state.model_copy(deep=True)

    def _after_arrival(self, state: InvestigationState, broadcast: bool = True) -> None:
        if state.anomaly_id is not None:
            self._anomalies.mark_arrived(state.anomaly_id, state.arrived_at)
        if broadcast:
            self._broadcast_state()

    def _commit(self, state: InvestigationState) -> None:
        """Records the verdict for the anomaly the robot is leaving, and for a
        final verdict tells Anomaly Detection (feedback)."""
        execution = self._execution.get_state()
        try:
            anomaly = self._anomalies.resolve(
                state.anomaly_id, state.draft_verdict, execution.mission_id if execution else None
            )
        except (AnomalyNotFoundError, InvalidAnomalyTransitionError):
            logger.warning("Investigation: could not record verdict for anomaly %s", state.anomaly_id, exc_info=True)
            return
        if state.draft_verdict in FINAL_VERDICTS:
            self._gateway.publish_anomaly_feedback(anomaly.anomaly_id, state.draft_verdict, anomaly.resolved_at)
        self._websocket.broadcast_threadsafe({"type": "anomaly.updated", "data": anomaly.model_dump(mode="json")})

    def _hand_back(self, robot_device_id: str) -> None:
        """A running mission (paused ones resume) takes the robot back;
        otherwise it holds where it is."""
        execution = self._execution.after_investigation()
        if execution is not None and execution.status == MissionStatus.RUNNING:
            if self._drive is not None:
                self._drive.rejoin()
            return
        self._gateway.publish_command(
            robot_device_id, "cancel_navigation", request_id=f"investigate-hold-{uuid.uuid4().hex[:8]}"
        )

    def _broadcast_state(self) -> None:
        state = self.get_state()
        self._websocket.broadcast_threadsafe(
            {"type": "investigation.updated", "data": state.model_dump(mode="json") if state else None}
        )


def _awaits_verdict(state: InvestigationState | None) -> bool:
    """On site at an anomaly without a verdict: it can't be left for another anomaly."""
    return (
        state is not None
        and state.kind == InvestigationKind.ANOMALY
        and state.phase == InvestigationPhase.ON_SITE
        and state.draft_verdict is None
    )


def _describe(state: InvestigationState) -> str:
    if state.kind == InvestigationKind.CAMERA:
        return f"Camera check for anomaly {state.anomaly_id}"
    if state.kind == InvestigationKind.EXPLORE:
        return "Explore"
    return f"Investigation of anomaly {state.anomaly_id}"
