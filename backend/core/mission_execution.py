import logging
import threading
from datetime import datetime, timezone

from core.errors import (
    InsufficientWaypointsError,
    InvalidExecutionTransitionError,
    MissionExecutionLockedError,
    NoCurrentMissionError,
)
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.mission_execution import MissionExecutionState, MissionStatus

logger = logging.getLogger(__name__)

MIN_WAYPOINTS_TO_START = 2

_EDIT_LOCKED_STATUSES = (MissionStatus.RUNNING, MissionStatus.PAUSED, MissionStatus.RETURNING_HOME)


class MissionExecutionManager:
    """Runtime execution state for whichever mission is current. Single global
    slot (only one mission can ever be current), in-memory only — a restart
    mid-mission resets to READY, same precedent as DeviceRegistry. Not
    persisted to YAML, unlike `Mission` itself (see models/mission.py)."""

    def __init__(self, mission_server: MissionServer, websocket_manager: WebSocketManager) -> None:
        self._mission_server = mission_server
        self._websocket_manager = websocket_manager
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
                raise InvalidExecutionTransitionError(f"Cannot start mission from status {state.status}")

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None or len(mission.waypoints) < MIN_WAYPOINTS_TO_START:
                raise InsufficientWaypointsError(
                    f"Mission requires at least {MIN_WAYPOINTS_TO_START} waypoints to start"
                )

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
                raise InvalidExecutionTransitionError(f"Cannot pause from status {state.status}")
            return self._apply(
                state.model_copy(update={"status": MissionStatus.PAUSED, "updated_at": datetime.now(timezone.utc)})
            )

    def resume(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status != MissionStatus.PAUSED:
                raise InvalidExecutionTransitionError(f"Cannot resume from status {state.status}")
            return self._apply(
                state.model_copy(update={"status": MissionStatus.RUNNING, "updated_at": datetime.now(timezone.utc)})
            )

    def stop(self) -> MissionExecutionState:
        with self._lock:
            state = self._require_state()
            if state.status not in (MissionStatus.RUNNING, MissionStatus.PAUSED):
                raise InvalidExecutionTransitionError(f"Cannot stop from status {state.status}")
            return self._apply(
                state.model_copy(
                    update={"status": MissionStatus.RETURNING_HOME, "updated_at": datetime.now(timezone.utc)}
                )
            )

    def record_waypoint_reached(self, waypoint_index: int) -> MissionExecutionState | None:
        """Producer-agnostic: called by the dev simulator (and, in principle,
        a future real-telemetry path) whenever the robot arrives at a
        waypoint. No-ops (returns the unchanged state) outside running/
        returning_home — never raises, since telemetry arriving after a Stop
        race is expected, not exceptional."""
        with self._lock:
            if self._state is None:
                return None
            state = self._state

            if state.status == MissionStatus.RETURNING_HOME:
                if waypoint_index == 0:
                    return self._apply(
                        state.model_copy(
                            update={
                                "status": MissionStatus.COMPLETED,
                                "current_waypoint_index": 0,
                                "updated_at": datetime.now(timezone.utc),
                            }
                        )
                    )
                return state.model_copy(deep=True)

            if state.status != MissionStatus.RUNNING:
                return state.model_copy(deep=True)

            mission = self._mission_server.get_mission(state.mission_id)
            if mission is None:
                return state.model_copy(deep=True)

            completed_loops = state.completed_loops
            current_loop = state.current_loop
            status = state.status

            if waypoint_index == 0 and state.current_waypoint_index != 0:
                completed_loops += 1
                if completed_loops >= mission.loop_count:
                    status = MissionStatus.COMPLETED
                else:
                    current_loop += 1

            return self._apply(
                state.model_copy(
                    update={
                        "status": status,
                        "current_loop": current_loop,
                        "completed_loops": completed_loops,
                        "current_waypoint_index": waypoint_index,
                        "updated_at": datetime.now(timezone.utc),
                    }
                )
            )

    def assert_editable(self, mission_id: str) -> None:
        """Raises if `mission_id` is the current mission and it's mid-execution.
        A no-op for any other mission_id — editing a mission that isn't
        current is always allowed."""
        with self._lock:
            if self._state is None or self._state.mission_id != mission_id:
                return
            if self._state.status in _EDIT_LOCKED_STATUSES:
                raise MissionExecutionLockedError(
                    "Mission editing is unavailable while the robot is executing or returning home."
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
