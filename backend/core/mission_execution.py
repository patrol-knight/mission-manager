import logging
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone

from core.device_registry import DeviceRegistry
from core.errors import (
    InsufficientWaypointsError,
    InvalidExecutionTransitionError,
    MissionExecutionLockedError,
    NoConnectedRobotError,
    NoCurrentMissionError,
    RobotNotReadyError,
)
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.mission_execution import MissionExecutionState, MissionStatus

logger = logging.getLogger(__name__)

MIN_WAYPOINTS_TO_START = 2

ACTIVE_STATUSES = (MissionStatus.RUNNING, MissionStatus.PAUSED)
_IDLE_STATUSES = (MissionStatus.READY, MissionStatus.NOT_READY)


class MissionExecutionManager:
    """Runtime execution state for whichever mission is current. Single global
    slot (only one mission can ever be current), in-memory only — a restart
    mid-mission resets to idle, same precedent as DeviceRegistry. Not
    persisted to YAML, unlike `Mission` itself (see models/mission.py)."""

    def __init__(
        self,
        mission_server: MissionServer,
        websocket_manager: WebSocketManager,
        device_registry: DeviceRegistry,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._mission_server = mission_server
        self._websocket_manager = websocket_manager
        self._device_registry = device_registry
        self._clock = clock
        self._lock = threading.RLock()
        self._state: MissionExecutionState | None = None
        # A dwell runs until _dwell_deadline (clock time); while PAUSED its
        # remaining time is frozen in _dwell_frozen instead.
        self._dwell_deadline: float | None = None
        self._dwell_frozen: float | None = None

    def sync_with_current(self) -> None:
        """Call once at startup, after MissionServer.load()."""
        with self._lock:
            current = self._mission_server.get_current()
            self._state = self._idle_state(current.mission_id) if current else None

    def _robot_ready(self) -> bool:
        robot = self._device_registry.get_connected_robot()
        return robot is not None and not robot.unavailable

    def _require_robot_ready(self, action: str) -> None:
        robot = self._device_registry.get_connected_robot()
        if robot is None:
            raise NoConnectedRobotError(f"Cannot {action} mission: no connected robot device")
        if robot.unavailable:
            raise RobotNotReadyError(f"Cannot {action} mission: the robot is {robot.unavailable_reason}")

    def _idle_state(self, mission_id: str) -> MissionExecutionState:
        return MissionExecutionState(
            mission_id=mission_id,
            status=MissionStatus.READY if self._robot_ready() else MissionStatus.NOT_READY,
            updated_at=datetime.now(timezone.utc),
        )

    def get_state(self) -> MissionExecutionState | None:
        with self._lock:
            return self._public(self._state) if self._state else None

    def _public(self, state: MissionExecutionState) -> MissionExecutionState:
        """A copy with the dwell's remaining time as of now."""
        remaining = None
        if state.dwell_sec is not None:
            if self._dwell_deadline is not None:
                remaining = max(0.0, self._dwell_deadline - self._clock())
            else:
                remaining = self._dwell_frozen
        return state.model_copy(update={"dwell_remaining_sec": remaining}, deep=True)

    def _require_state(self) -> MissionExecutionState:
        if self._state is None:
            raise NoCurrentMissionError("No current mission is set")
        return self._state

    def _apply(self, state: MissionExecutionState) -> MissionExecutionState:
        if state.status not in ACTIVE_STATUSES or state.dwell_sec is None:
            self._dwell_deadline = self._dwell_frozen = None
            state = state.model_copy(update={"dwell_sec": None})
        self._state = state
        self._broadcast(state)
        return self._public(state)

    def _update(self, state: MissionExecutionState, **fields) -> MissionExecutionState:
        return self._apply(state.model_copy(update={**fields, "updated_at": datetime.now(timezone.utc)}))

    def _broadcast(self, state: MissionExecutionState | None) -> None:
        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "mission.execution",
                "data": self._public(state).model_dump(mode="json") if state else None,
            }
        )

    def refresh_readiness(self) -> None:
        """READY <-> NOT_READY for an idle mission as the robot comes and goes."""
        with self._lock:
            state = self._state
            if state is None or state.status not in _IDLE_STATUSES:
                return
            status = MissionStatus.READY if self._robot_ready() else MissionStatus.NOT_READY
            if status != state.status:
                self._update(state, status=status)

    def start(self, start_index: int) -> MissionExecutionState:
        """The waypoints before `start_index` count as done this loop."""
        with self._lock:
            state = self._require_state()
            if state.status not in _IDLE_STATUSES:
                raise InvalidExecutionTransitionError(f"Cannot start mission from status {state.status.value}")

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None or len(mission.waypoints) < MIN_WAYPOINTS_TO_START:
                raise InsufficientWaypointsError(
                    f"Mission requires at least {MIN_WAYPOINTS_TO_START} waypoints to start"
                )

            self._require_robot_ready("start")

            return self._update(
                state,
                status=MissionStatus.RUNNING,
                current_loop=1,
                completed_loops=0,
                current_waypoint_index=0,
                target_waypoint_index=start_index % len(mission.waypoints),
                joining=True,
            )

    def pause(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.RUNNING:
                raise InvalidExecutionTransitionError(f"Cannot pause from status {state.status.value}")
            if self._dwell_deadline is not None:
                self._dwell_frozen = max(0.0, self._dwell_deadline - self._clock())
                self._dwell_deadline = None
            return self._update(state, status=MissionStatus.PAUSED)

    def resume(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.PAUSED:
                raise InvalidExecutionTransitionError(f"Cannot resume from status {state.status.value}")
            self._require_robot_ready("resume")
            if self._dwell_frozen is not None:
                self._dwell_deadline = self._clock() + self._dwell_frozen
                self._dwell_frozen = None
            return self._update(state, status=MissionStatus.RUNNING)

    def cancel(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status not in ACTIVE_STATUSES:
                raise InvalidExecutionTransitionError(f"Cannot cancel from status {state.status.value}")
            return self._apply(self._idle_state(state.mission_id))

    def abort(self) -> bool:
        """cancel() that never raises, for MissionService.abort_autonomy.
        Returns whether anything changed."""
        with self._lock:
            state = self._state
            if state is None or state.status not in ACTIVE_STATUSES:
                return False
            self._apply(self._idle_state(state.mission_id))
            return True

    def after_investigation(self) -> MissionExecutionState | None:
        """PAUSED -> RUNNING: the robot is off-route now, so it rejoins rather
        than sitting where the operator paused it."""
        with self._lock:
            state = self._state
            if state is None:
                return None
            if state.status == MissionStatus.PAUSED:
                return self._update(state, status=MissionStatus.RUNNING)
            return self._public(state)

    def join_at(self, waypoint_index: int) -> None:
        with self._lock:
            state = self._state
            # The same target is no join: its arrival still counts a loop.
            if state is None or state.status != MissionStatus.RUNNING or state.target_waypoint_index == waypoint_index:
                return
            self._update(state, target_waypoint_index=waypoint_index, joining=True, dwell_sec=None)

    # -- Dwell -----------------------------------------------------------------

    def is_dwelling(self) -> bool:
        """Holding at a waypoint, running or paused."""
        with self._lock:
            return self._state is not None and self._state.dwell_sec is not None

    def dwell_left(self) -> float | None:
        """Seconds left of a running dwell; None when there is none."""
        with self._lock:
            if self._state is None or self._state.status != MissionStatus.RUNNING or self._dwell_deadline is None:
                return None
            return max(0.0, self._dwell_deadline - self._clock())

    def end_dwell(self) -> None:
        """The dwell is over (or dropped): the robot heads on."""
        with self._lock:
            state = self._state
            if state is not None and state.dwell_sec is not None:
                self._update(state, dwell_sec=None)

    def drop_dwell(self) -> None:
        """Something else took the robot (an investigation, Go here)."""
        self.end_dwell()

    def record_waypoint_reached(self, waypoint_index: int) -> MissionExecutionState | None:
        """No-op unless RUNNING towards this waypoint: an arrival racing a
        Cancel is expected, so this never raises."""
        with self._lock:
            if self._state is None:
                return None
            state = self._state
            if state.status != MissionStatus.RUNNING or state.target_waypoint_index != waypoint_index:
                return self._public(state)

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None or not mission.waypoints:
                return self._public(state)

            completed_loops = state.completed_loops
            current_loop = state.current_loop
            status = state.status

            if waypoint_index == 0 and not state.joining:
                completed_loops += 1
                if not mission.infinite_loop and completed_loops >= mission.loop_count:
                    status = MissionStatus.COMPLETED
                else:
                    current_loop += 1

            new_state = state.model_copy(
                update={
                    "status": status,
                    "current_loop": current_loop,
                    "completed_loops": completed_loops,
                    "current_waypoint_index": waypoint_index,
                    "target_waypoint_index": (waypoint_index + 1) % len(mission.waypoints),
                    "joining": False,
                    "updated_at": datetime.now(timezone.utc),
                }
            )
            if status == MissionStatus.COMPLETED:
                return self._finish_mission(new_state)
            dwell = mission.waypoints[waypoint_index].dwell_sec
            if dwell > 0:
                self._dwell_deadline = self._clock() + dwell
                self._dwell_frozen = None
                new_state = new_state.model_copy(update={"dwell_sec": dwell})
            else:
                new_state = new_state.model_copy(update={"dwell_sec": None})
            return self._apply(new_state)

    def _finish_mission(self, completed_state: MissionExecutionState) -> MissionExecutionState:
        """Broadcasts COMPLETED once (MissionCompleteWatcher's toast reads the
        loop count off it), then resets to idle."""
        self._apply(completed_state.model_copy(update={"target_waypoint_index": None}))
        return self._apply(self._idle_state(completed_state.mission_id))

    def assert_editable(self, mission_id: str) -> None:
        """Raises if `mission_id` is the current mission and it's mid-execution.
        A no-op for any other mission_id — editing a mission that isn't
        current is always allowed."""
        with self._lock:
            if self._state is None or self._state.mission_id != mission_id:
                return
            if self._state.status in ACTIVE_STATUSES:
                raise MissionExecutionLockedError("Mission editing is unavailable while the mission is running.")

    def on_activated(self, mission_id: str) -> None:
        with self._lock:
            self._apply(self._idle_state(mission_id))

    def on_deleted(self, mission_id: str) -> None:
        with self._lock:
            if self._state is not None and self._state.mission_id == mission_id:
                self._state = None
                self._broadcast(None)
