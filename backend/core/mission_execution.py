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

_EDIT_LOCKED_STATUSES = (
    MissionStatus.RUNNING,
    MissionStatus.PAUSED,
    MissionStatus.RETURNING,
)


class MissionExecutionManager:
    """Runtime execution state for whichever mission is current. Single global
    slot (only one mission can ever be current), in-memory only — a restart
    mid-mission resets to READY, same precedent as DeviceRegistry. Not
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
            self._state = self._fresh_state(current.mission_id) if current else None

    @staticmethod
    def _fresh_state(mission_id: str) -> MissionExecutionState:
        return MissionExecutionState(
            mission_id=mission_id,
            status=MissionStatus.READY,
            current_loop=0,
            completed_loops=0,
            current_waypoint_index=0,
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

    def _broadcast(self, state: MissionExecutionState | None) -> None:
        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "mission.execution.updated",
                "data": state.model_dump(mode="json") if state else None,
            }
        )

    def start(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status not in (MissionStatus.READY, MissionStatus.COMPLETED):
                raise InvalidExecutionTransitionError(f"Cannot start mission from status {state.status.value}")

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None or len(mission.waypoints) < MIN_WAYPOINTS_TO_START:
                raise InsufficientWaypointsError(
                    f"Mission requires at least {MIN_WAYPOINTS_TO_START} waypoints to start"
                )

            if self._device_registry.get_connected_robot() is None:
                raise NoConnectedRobotError("Cannot start mission: no connected robot device")

            return self._apply(
                state.model_copy(
                    update={
                        "status": MissionStatus.RUNNING,
                        "current_loop": 1,
                        "completed_loops": 0,
                        "current_waypoint_index": 0,
                        "updated_at": datetime.now(timezone.utc),
                    }
                )
            )

    def pause(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.RUNNING:
                raise InvalidExecutionTransitionError(f"Cannot pause from status {state.status.value}")
            return self._apply(
                state.model_copy(update={"status": MissionStatus.PAUSED, "updated_at": datetime.now(timezone.utc)})
            )

    def resume(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.PAUSED:
                raise InvalidExecutionTransitionError(f"Cannot resume from status {state.status.value}")
            return self._apply(
                state.model_copy(update={"status": MissionStatus.RUNNING, "updated_at": datetime.now(timezone.utc)})
            )

    def stop(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status not in (MissionStatus.RUNNING, MissionStatus.PAUSED):
                raise InvalidExecutionTransitionError(f"Cannot stop from status {state.status.value}")
            return self._apply(
                state.model_copy(update={"status": MissionStatus.RETURNING, "updated_at": datetime.now(timezone.utc)})
            )

    def abort(self) -> bool:
        """Drops a mission in progress (RUNNING/PAUSED/RETURNING) straight to a
        fresh READY -- autonomy was aborted (MissionService.abort_autonomy) and
        the operator has to Start again. Returns whether anything changed."""
        with self._lock:
            state = self._state
            if state is None or state.status not in _EDIT_LOCKED_STATUSES:
                return False
            self._apply(self._fresh_state(state.mission_id))
            return True

    def after_investigation(self) -> MissionExecutionState | None:
        """Hands the robot back to the mission when an investigation ends
        (core/investigation.py), so the robot always ends up doing something
        the mission card shows:

        - PAUSED -> RUNNING: the robot is off-route now, so it rejoins rather
          than sitting where the operator paused it (possibly long ago).
        - READY -> RETURNING: back to waypoint 0, then READY again.
        - RUNNING / RETURNING: unchanged, the robot carries on.

        Returns the resulting state, or None if there's no current mission."""
        with self._lock:
            state = self._state
            if state is None:
                return None
            if state.status == MissionStatus.PAUSED:
                next_status = MissionStatus.RUNNING
            elif state.status in (MissionStatus.READY, MissionStatus.COMPLETED):
                mission = self._mission_server.get_mission(state.mission_id)
                if mission is None or not mission.waypoints:
                    return state.model_copy(deep=True)
                next_status = MissionStatus.RETURNING
            else:
                return state.model_copy(deep=True)
            return self._apply(state.model_copy(update={"status": next_status, "updated_at": datetime.now(timezone.utc)}))

    def record_waypoint_reached(self, waypoint_index: int, *, rejoined: bool = False) -> MissionExecutionState | None:
        """Called by MissionDriveCoordinator whenever the robot arrives at a
        waypoint. No-ops (returns the unchanged state) outside RUNNING/
        RETURNING — never raises, since an arrival racing a Stop is expected,
        not exceptional.

        `rejoined` marks the first waypoint reached after an investigation:
        the robot jumped there from off-route, so it doesn't count as
        finishing a loop even if it is waypoint 0 -- the loop just restarts,
        rather than the mission completing with waypoints skipped."""
        with self._lock:
            if self._state is None:
                return None
            state = self._state

            if state.status == MissionStatus.RETURNING:
                if waypoint_index == 0:
                    # Unlike finishing all configured loops naturally (below),
                    # a manual Stop never reports COMPLETED -- that status
                    # (and MissionCompleteWatcher's "Mission Complete!" toast)
                    # is reserved for a mission that actually ran to
                    # completion. completed_loops is never incremented on
                    # this path, so reusing COMPLETED here would show a
                    # misleading "Mission Complete! 1 / 3 loops" for a mission
                    # stopped early. Straight back to a fresh READY state,
                    # no pulse, no toast.
                    return self._apply(self._fresh_state(state.mission_id))
                return state.model_copy(deep=True)

            if state.status != MissionStatus.RUNNING:
                return state.model_copy(deep=True)

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None:
                return state.model_copy(deep=True)

            completed_loops = state.completed_loops
            current_loop = state.current_loop
            status = state.status

            if waypoint_index == 0 and state.current_waypoint_index != 0 and not rejoined:
                completed_loops += 1
                if completed_loops >= mission.loop_count:
                    status = MissionStatus.COMPLETED
                else:
                    current_loop += 1

            new_state = state.model_copy(
                update={
                    "status": status,
                    "current_loop": current_loop,
                    "completed_loops": completed_loops,
                    "current_waypoint_index": waypoint_index,
                    "updated_at": datetime.now(timezone.utc),
                }
            )
            if status == MissionStatus.COMPLETED:
                return self._finish_mission(new_state)
            return self._apply(new_state)

    def _finish_mission(self, completed_state: MissionExecutionState) -> MissionExecutionState:
        """Only reached by naturally finishing all configured loops while
        RUNNING (see record_waypoint_reached) -- a manual Stop's
        RETURNING->READY path deliberately does NOT call this, since
        that's not the same outcome. Broadcasts the COMPLETED transition --
        so a client can catch it going by (e.g. MissionCompleteWatcher's
        toast, which reads the final loop count off this exact message) --
        then immediately resets to READY. A finished mission should be
        exactly as startable as a brand new one, not require a separate
        "completed" status/affordance."""
        self._apply(completed_state)
        return self._apply(self._fresh_state(completed_state.mission_id))

    def assert_editable(self, mission_id: str) -> None:
        """Raises if `mission_id` is the current mission and it's mid-execution.
        A no-op for any other mission_id — editing a mission that isn't
        current is always allowed."""
        with self._lock:
            if self._state is None or self._state.mission_id != mission_id:
                return
            if self._state.status in _EDIT_LOCKED_STATUSES:
                raise MissionExecutionLockedError(
                    "Mission editing is unavailable while the robot is executing or returning to start."
                )

    def on_activated(self, mission_id: str) -> None:
        with self._lock:
            self._apply(self._fresh_state(mission_id))

    def on_edited(self, mission_id: str) -> None:
        """If the edited mission is current and COMPLETED, editing resets it
        to READY (per the READY<->COMPLETED editable-status pair)."""
        with self._lock:
            if (
                self._state is not None
                and self._state.mission_id == mission_id
                and self._state.status == MissionStatus.COMPLETED
            ):
                self._apply(self._fresh_state(mission_id))

    def on_deleted(self, mission_id: str) -> None:
        with self._lock:
            if self._state is not None and self._state.mission_id == mission_id:
                self._state = None
                self._broadcast(None)
