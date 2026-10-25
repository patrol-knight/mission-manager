import logging
import threading
from datetime import datetime, timezone

from core.device_registry import DeviceRegistry
from core.errors import (
    InsufficientWaypointsError,
    InvalidExecutionTransitionError,
    MissionExecutionLockedError,
    NoConnectedRobotError,
    NoCurrentMissionError,
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
        self, mission_server: MissionServer, websocket_manager: WebSocketManager, device_registry: DeviceRegistry
    ) -> None:
        self._mission_server = mission_server
        self._websocket_manager = websocket_manager
        self._device_registry = device_registry
        self._lock = threading.RLock()
        self._state: MissionExecutionState | None = None

    def sync_with_current(self) -> None:
        """Call once at startup, after MissionServer.load()."""
        with self._lock:
            current = self._mission_server.get_current()
            self._state = self._idle_state(current.mission_id) if current else None

    def _robot_ready(self) -> bool:
        # The robot's own not-ready/failed states belong here once it reports them.
        return self._device_registry.get_connected_robot() is not None

    def _idle_state(self, mission_id: str) -> MissionExecutionState:
        return MissionExecutionState(
            mission_id=mission_id,
            status=MissionStatus.READY if self._robot_ready() else MissionStatus.NOT_READY,
            updated_at=datetime.now(timezone.utc),
        )

    def get_state(self) -> MissionExecutionState | None:
        with self._lock:
            return self._state.model_copy(deep=True) if self._state else None

    def _require_state(self) -> MissionExecutionState:
        if self._state is None:
            raise NoCurrentMissionError("No current mission is set")
        return self._state

    def _apply(self, state: MissionExecutionState) -> MissionExecutionState:
        self._state = state
        self._broadcast(state)
        return state.model_copy(deep=True)

    def _update(self, state: MissionExecutionState, **fields) -> MissionExecutionState:
        return self._apply(state.model_copy(update={**fields, "updated_at": datetime.now(timezone.utc)}))

    def _broadcast(self, state: MissionExecutionState | None) -> None:
        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "mission.execution",
                "data": state.model_dump(mode="json") if state else None,
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

            if not self._robot_ready():
                raise NoConnectedRobotError("Cannot start mission: no connected robot device")

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
            return self._update(state, status=MissionStatus.PAUSED)

    def resume(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.PAUSED:
                raise InvalidExecutionTransitionError(f"Cannot resume from status {state.status.value}")
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
            return state.model_copy(deep=True)

    def join_at(self, waypoint_index: int) -> None:
        with self._lock:
            state = self._state
            if state is None or state.status != MissionStatus.RUNNING:
                return
            self._update(state, target_waypoint_index=waypoint_index, joining=True)

    def record_waypoint_reached(self, waypoint_index: int) -> MissionExecutionState | None:
        """No-op unless RUNNING towards this waypoint: an arrival racing a
        Cancel is expected, so this never raises."""
        with self._lock:
            if self._state is None:
                return None
            state = self._state
            if state.status != MissionStatus.RUNNING or state.target_waypoint_index != waypoint_index:
                return state.model_copy(deep=True)

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None or not mission.waypoints:
                return state.model_copy(deep=True)

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
