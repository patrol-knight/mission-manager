import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import (
    AnomalyNotFoundError,
    InvalidAnomalyTransitionError,
    MapUnavailableError,
    NoActiveInvestigationError,
    NoConnectedRobotError,
    NoRouteError,
    NotOnSiteError,
    VerdictRequiredError,
)
from core.goal_arrival import arrived_at
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.websocket_manager import WebSocketManager
from models.anomaly import FINAL_VERDICTS, AnomalyVerdict
from models.device import DeviceView
from models.investigation import InvestigationPhase, InvestigationState
from models.mission_execution import MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)


class InvestigationCoordinator:
    """The operator-driven investigate mode (README "Mission & Investigation
    State Machines"): NONE -> EN_ROUTE -> ON_SITE -> NONE, in parallel with
    the mission and taking priority over it -- while an investigation is
    active, mission drive sends no goals and MissionService refuses mission
    transitions.

    - start(): send the robot to an anomaly, or switch to another one.
    - on_device_state(): EN_ROUTE -> ON_SITE when the robot reports arrival.
    - set_verdict(): the operator's draft verdict while ON_SITE.
    - stop(): leave investigate mode -- Stop (EN_ROUTE, nothing to commit) or
      Finish (ON_SITE, commits the verdict) -- and hand the robot back to the
      mission (MissionExecutionManager.after_investigation()).

    The verdict is committed only when the robot leaves the anomaly, and a
    robot can't leave ON_SITE until one is chosen (VerdictRequiredError).

    State changes happen under the lock; registry writes, broadcasts and robot
    commands happen after it is released, so a slow database or socket never
    blocks the Zenoh thread that reports arrivals."""

    def __init__(
        self,
        anomaly_registry: AnomalyRegistry,
        mission_execution_manager: MissionExecutionManager,
        map_server: MapServer,
        device_registry: DeviceRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._anomalies = anomaly_registry
        self._execution = mission_execution_manager
        self._map = map_server
        self._devices = device_registry
        self._gateway = zenoh_gateway
        self._websocket = websocket_manager
        self._drive: "MissionDriveCoordinator | None" = None

        self._lock = threading.RLock()
        self._state: InvestigationState | None = None
        # The robot's DeviceState.timestamp when the current goal was sent --
        # an "arrived" sample only counts if it is strictly newer, so a stale
        # "arrived" from before (e.g. the robot was parked at a waypoint)
        # can't complete a goal it never acted on.
        self._issued_after_timestamp = 0.0
        self._goal_count = 0

    def bind_mission_drive(self, mission_drive: "MissionDriveCoordinator") -> None:
        """Late-bound: mission drive needs this class too (see bootstrap.py)."""
        self._drive = mission_drive

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

    # -- Commands ----------------------------------------------------------------

    def start(self, anomaly_id: str) -> InvestigationState:
        """Sends the robot to an anomaly. While already investigating, switches
        target: an EN_ROUTE target is abandoned (no verdict), an ON_SITE one
        has its verdict committed -- which requires one to be chosen."""
        robot = self._devices.get_connected_robot()
        if robot is None:
            raise NoConnectedRobotError("The robot is not connected")
        anomaly = self._anomalies.get(anomaly_id)
        if anomaly is None:
            raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
        if anomaly.is_closed:
            raise InvalidAnomalyTransitionError(f"Anomaly already resolved: {anomaly_id}")
        if not self._map.is_available():
            raise MapUnavailableError("Map service is unavailable: cannot route to the anomaly")

        target = self._map.snap_to_lanelet(anomaly.x, anomaly.y, anomaly.frame_id)
        route = self._map.get_route([{"x": robot.pose.x, "y": robot.pose.y}, {"x": target.x, "y": target.y}])
        if route is None:
            raise NoRouteError(f"No route from the robot to anomaly {anomaly_id}")

        with self._lock:
            previous = self._state
            if previous is not None and previous.anomaly_id == anomaly_id:
                return previous.model_copy(deep=True)
            if previous is not None and previous.phase == InvestigationPhase.ON_SITE and previous.draft_verdict is None:
                raise VerdictRequiredError("Verify the current anomaly first")
            # Atomic with expiry: the anomaly may have expired since get().
            if self._anomalies.set_target(anomaly_id) is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            self._goal_count += 1
            self._issued_after_timestamp = robot.timestamp
            self._state = InvestigationState(
                anomaly_id=anomaly_id,
                robot_device_id=robot.device_id,
                phase=InvestigationPhase.EN_ROUTE,
                target=target,
                route=route,
                started_at=datetime.now(timezone.utc),
            )
            state = self._state.model_copy(deep=True)
            goal_count = self._goal_count

        if previous is None:
            # The investigation now owns the robot: drop mission drive's
            # in-flight waypoint goal, which the command below supersedes.
            if self._drive is not None:
                self._drive.abort()
        elif previous.phase == InvestigationPhase.ON_SITE:
            self._commit(previous)

        self._broadcast_state()
        self._gateway.publish_command(
            robot.device_id,
            "navigate_to_goal",
            request_id=f"investigate-{anomaly_id}-{goal_count}",
            fields={"x": target.x, "y": target.y, "frame_id": target.frame_id},
        )
        logger.info("Investigation: robot %s heading to anomaly %s", robot.device_id, anomaly_id)
        return state

    def set_verdict(self, verdict: AnomalyVerdict) -> InvestigationState:
        with self._lock:
            if self._state is None:
                raise NoActiveInvestigationError("The robot is not investigating")
            if self._state.phase != InvestigationPhase.ON_SITE:
                raise NotOnSiteError("The robot hasn't reached the anomaly yet")
            self._state = self._state.model_copy(update={"draft_verdict": verdict})
            state = self._state.model_copy(deep=True)
        self._broadcast_state()
        return state

    def stop(self) -> None:
        """Leaves investigate mode: Stop while EN_ROUTE (nothing to commit) or
        Finish while ON_SITE (commits the chosen verdict). Then hands the
        robot back to the mission."""
        with self._lock:
            previous = self._state
            if previous is None:
                raise NoActiveInvestigationError("The robot is not investigating")
            if previous.phase == InvestigationPhase.ON_SITE and previous.draft_verdict is None:
                raise VerdictRequiredError("Verify the current anomaly first")
            self._state = None
            self._anomalies.set_target(None)

        if previous.phase == InvestigationPhase.ON_SITE:
            self._commit(previous)
        self._broadcast_state()
        logger.info("Investigation of anomaly %s ended (%s)", previous.anomaly_id, previous.phase.value)
        self._hand_back(previous.robot_device_id)

    # -- Robot events --------------------------------------------------------------

    def on_device_state(self, view: DeviceView) -> None:
        """Called by ZenohGateway for every meaningfully-changed device state.
        A cheap no-op unless it is the robot reporting arrival while
        EN_ROUTE."""
        with self._lock:
            state = self._state
            if state is None or state.phase != InvestigationPhase.EN_ROUTE:
                return
            if view.device_id != state.robot_device_id:
                return
            if not arrived_at(view, state.target.x, state.target.y, self._issued_after_timestamp):
                return
            self._state = state.model_copy(
                update={"phase": InvestigationPhase.ON_SITE, "arrived_at": datetime.now(timezone.utc)}
            )
        self._broadcast_state()
        logger.info("Investigation: robot arrived at anomaly %s", state.anomaly_id)

    def cancel(self) -> InvestigationState | None:
        """Ends the investigation without a verdict and without handing the
        robot back to the mission -- for when autonomy is aborted altogether
        (MissionService.abort_autonomy). Returns what was cancelled, if
        anything."""
        with self._lock:
            state = self._state
            if state is None:
                return None
            self._state = None
            self._anomalies.set_target(None)
        self._broadcast_state()
        logger.warning("Investigation of anomaly %s cancelled", state.anomaly_id)
        return state

    # -- Internals -------------------------------------------------------------------

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
        """The hand-back rules (README table): the mission takes the robot
        back -- rejoining the route, or returning to waypoint 0 -- or, with no
        mission to go back to, the robot holds where it is."""
        execution = self._execution.after_investigation()
        if execution is not None and execution.status in (MissionStatus.RUNNING, MissionStatus.RETURNING):
            if self._drive is not None:
                if execution.status == MissionStatus.RUNNING:
                    self._drive.request_rejoin()
                self._drive.advance()
            return
        self._gateway.publish_command(
            robot_device_id, "cancel_navigation", request_id=f"investigate-hold-{uuid.uuid4().hex[:8]}"
        )

    def _broadcast_state(self) -> None:
        state = self.get_state()
        self._websocket.broadcast_threadsafe(
            {"type": "investigation.updated", "data": state.model_dump(mode="json") if state else None}
        )
