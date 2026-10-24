import logging
import time
import uuid
from typing import TYPE_CHECKING

from core.device_registry import DeviceRegistry
from core.errors import InvestigationActiveError, MapUnavailableError, MissionNotFoundError, NoCurrentMissionError
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.mission import Mission, MissionGeo, MissionSummary, WaypointGeo
from models.mission_execution import MissionExecutionState, MissionStatus
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.investigation import InvestigationCoordinator
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)

# Mission statuses in which the robot is driving (or about to) on its own.
_ACTIVE_STATUSES = (MissionStatus.RUNNING, MissionStatus.PAUSED, MissionStatus.RETURNING)


class MissionService:
    """The mission use cases the API exposes -- mission CRUD and
    start/pause/resume/stop -- each tying together the pieces that must move
    in step: MissionServer (definitions + YAML), MissionExecutionManager
    (runtime status), MissionDriveCoordinator (robot goals) and the robot
    itself. Routers in api/ call exactly one method here and never sequence
    those pieces themselves. Raises core/errors.py exceptions, which
    api/errors.py maps to HTTP status codes.

    While the robot is investigating, the mission is frozen: every transition
    and any change to the current mission raises InvestigationActiveError.
    The investigation hands the robot back itself when it ends
    (InvestigationCoordinator._hand_back)."""

    def __init__(
        self,
        mission_server: MissionServer,
        map_server: MapServer,
        execution_manager: MissionExecutionManager,
        mission_drive: "MissionDriveCoordinator",
        investigation: "InvestigationCoordinator",
        device_registry: DeviceRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._missions = mission_server
        self._map = map_server
        self._execution = execution_manager
        self._drive = mission_drive
        self._investigation = investigation
        self._devices = device_registry
        self._gateway = zenoh_gateway
        self._websocket = websocket_manager

    # -- Mission definitions -------------------------------------------------

    def list_missions(self) -> list[MissionSummary]:
        return self._missions.list_missions(self._map)

    def get_mission(self, mission_id: str) -> MissionGeo:
        mission = self._missions.get_mission(mission_id)
        if mission is None:
            raise MissionNotFoundError(f"Mission not found: {mission_id}")
        return self._with_geo(mission)

    def get_current(self) -> MissionGeo:
        current = self.current_or_none()
        if current is None:
            raise NoCurrentMissionError("No current mission is set")
        return current

    def current_or_none(self) -> MissionGeo | None:
        current = self._missions.get_current()
        return self._with_geo(current) if current is not None else None

    def create_mission(self, mission: Mission, activate: bool = False) -> MissionGeo:
        created = self._missions.create_mission(self._with_map_name(mission))
        if activate:
            return self.activate(created.mission_id)
        return self._with_geo(created)

    def update_mission(self, mission_id: str, mission: Mission, activate: bool = False) -> MissionGeo:
        self._assert_current_unlocked(mission_id)
        self._execution.assert_editable(mission_id)
        updated = self._missions.update_mission(mission_id, self._with_map_name(mission))
        self._execution.on_edited(mission_id)
        if activate:
            return self.activate(mission_id)
        self._broadcast_current()
        return self._with_geo(updated)

    def delete_mission(self, mission_id: str) -> None:
        self._assert_current_unlocked(mission_id)
        self._execution.assert_editable(mission_id)
        self._missions.delete_mission(mission_id)
        self._execution.on_deleted(mission_id)
        self._broadcast_current()

    def activate(self, mission_id: str) -> MissionGeo:
        self._assert_not_investigating()
        activated = self._missions.activate(mission_id)
        self._execution.on_activated(mission_id)
        self._broadcast_current()
        return self._with_geo(activated)

    # -- Execution -----------------------------------------------------------

    def get_execution(self) -> MissionExecutionState:
        state = self._execution.get_state()
        if state is None:
            raise NoCurrentMissionError("No current mission is set")
        return state

    def start(self) -> MissionExecutionState:
        self._assert_not_investigating()
        result = self._execution.start()
        self._drive.advance()
        return result

    def pause(self) -> MissionExecutionState:
        self._assert_not_investigating()
        result = self._execution.pause()
        self._drive.abort()
        # The robot has no concept of "pause" and keeps driving toward its
        # last goal unless explicitly told to stop (see device_gateway's
        # NavigationGatewayComponent / dummy_robot_node.py's cancel_navigation).
        robot = self._devices.get_connected_robot()
        if robot is not None:
            self._gateway.publish_command(
                robot.device_id, "cancel_navigation", request_id=f"pause-{uuid.uuid4().hex[:8]}"
            )
        return result

    def resume(self) -> MissionExecutionState:
        self._assert_not_investigating()
        result = self._execution.resume()
        self._drive.advance()
        return result

    def stop(self) -> MissionExecutionState:
        self._assert_not_investigating()
        result = self._execution.stop()
        self._drive.abort()
        self._drive.advance()  # drives the return to waypoint 0 (RETURNING)
        return result

    # -- Aborting autonomy ------------------------------------------------------

    def abort_autonomy(self, reason: str) -> bool:
        """Stops everything the robot does on its own: cancels the
        investigation (no verdict) and drops the mission to READY. Nothing
        resumes by itself -- the operator has to Start or Investigate again.
        Used when the robot is lost (abort_if_robot_lost) and, later, when the
        joystick takes over. Returns whether anything was running."""
        cancelled = self._investigation.cancel()
        aborted = self._execution.abort()
        if cancelled is None and not aborted:
            return False
        self._drive.abort()

        robot = self._devices.get_robot()
        if robot is not None:
            if robot.connected:
                self._gateway.publish_command(
                    robot.device_id, "cancel_navigation", request_id=f"abort-{uuid.uuid4().hex[:8]}"
                )
            else:
                self._drive.cancel_on_reconnect(robot.device_id)

        self._websocket.broadcast_threadsafe(
            {
                "type": "autonomy.aborted",
                "data": {"reason": reason, "anomaly_id": cancelled.anomaly_id if cancelled else None},
            }
        )
        logger.warning("Autonomy aborted (%s)", reason)
        return True

    def abort_if_robot_lost(self, grace_sec: float) -> None:
        """Call on every monitor tick. Aborts autonomy once the robot has been
        offline for longer than `grace_sec`; a no-op otherwise, or when
        nothing is running."""
        robot = self._devices.get_robot()
        if robot is None or robot.connected or time.time() - robot.last_seen < grace_sec:
            return
        execution = self._execution.get_state()
        mission_active = execution is not None and execution.status in _ACTIVE_STATUSES
        if mission_active or self._investigation.is_active():
            self.abort_autonomy("robot_disconnected")

    # -- Helpers -------------------------------------------------------------

    def _assert_not_investigating(self) -> None:
        if self._investigation.is_active():
            raise InvestigationActiveError("Not available while the robot is investigating")

    def _assert_current_unlocked(self, mission_id: str) -> None:
        current = self._missions.get_current()
        if current is not None and current.mission_id == mission_id:
            self._assert_not_investigating()

    def _with_map_name(self, mission: Mission) -> Mission:
        if mission.map_name:
            return mission
        map_name = self._map.get_info().map_name if self._map.is_available() else "default"
        return mission.model_copy(update={"map_name": map_name})

    def _with_geo(self, mission: Mission) -> MissionGeo:
        waypoints = []
        for wp in mission.waypoints:
            lat = lon = None
            if self._map.is_available():
                try:
                    latlon = self._map.xy_to_latlon(wp.x, wp.y, mission.frame_id)
                    lat, lon = latlon.lat, latlon.lon
                except MapUnavailableError:
                    pass
            waypoints.append(WaypointGeo(**wp.model_dump(), lat=lat, lon=lon))
        return MissionGeo(**mission.model_dump(exclude={"waypoints"}), waypoints=waypoints)

    def _broadcast_current(self) -> None:
        current = self.current_or_none()
        self._websocket.broadcast_threadsafe(
            {"type": "mission.current", "data": current.model_dump(mode="json") if current else None}
        )
