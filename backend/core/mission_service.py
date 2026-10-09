import logging
import uuid
from typing import TYPE_CHECKING

from core.device_registry import DeviceRegistry
from core.errors import MapUnavailableError, MissionNotFoundError, NoCurrentMissionError
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.mission import Mission, MissionGeo, MissionSummary, WaypointGeo
from models.mission_execution import MissionExecutionState
from transport.zenoh_gateway import ZenohGateway

if TYPE_CHECKING:
    from core.anomaly_response import AnomalyResponseCoordinator
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)


class MissionService:
    """The mission use cases the API exposes -- mission CRUD and
    start/pause/resume/stop -- each tying together the pieces that must move
    in step: MissionServer (definitions + YAML), MissionExecutionManager
    (runtime status), MissionDriveCoordinator (robot goals),
    AnomalyResponseCoordinator (diversions) and the robot itself. Routers in
    api/ call exactly one method here and never sequence those pieces
    themselves. Raises core/errors.py exceptions, which api/errors.py maps to
    HTTP status codes."""

    def __init__(
        self,
        mission_server: MissionServer,
        map_server: MapServer,
        execution_manager: MissionExecutionManager,
        mission_drive: "MissionDriveCoordinator",
        anomaly_response: "AnomalyResponseCoordinator",
        device_registry: DeviceRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._missions = mission_server
        self._map = map_server
        self._execution = execution_manager
        self._drive = mission_drive
        self._anomaly_response = anomaly_response
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

    def get_default(self) -> MissionGeo:
        mission = self._missions.get_default()
        if mission is None:
            raise MissionNotFoundError("No default mission is set")
        return self._with_geo(mission)

    def create_mission(self, mission: Mission) -> MissionGeo:
        return self._with_geo(self._missions.create_mission(mission))

    def update_mission(self, mission_id: str, mission: Mission) -> MissionGeo:
        self._execution.assert_editable(mission_id)
        updated = self._missions.update_mission(mission_id, mission)
        self._execution.on_edited(mission_id)
        self._broadcast_current()
        return self._with_geo(updated)

    def delete_mission(self, mission_id: str) -> None:
        # No diversion abort here, deliberately: assert_editable blocks
        # deleting the current mission while it's executing (the only window
        # a diversion can be active in), so aborting would only ever clear a
        # legitimate diversion on a *different*, still-running mission.
        self._execution.assert_editable(mission_id)
        self._missions.delete_mission(mission_id)
        self._execution.on_deleted(mission_id)
        self._broadcast_current()

    def activate(self, mission_id: str) -> MissionGeo:
        activated = self._missions.activate(mission_id)
        self._execution.on_activated(mission_id)
        self._broadcast_current()
        self._anomaly_response.end_run("mission_switched")
        return self._with_geo(activated)

    def set_default(self, mission_id: str) -> MissionGeo:
        return self._with_geo(self._missions.set_default(mission_id))

    # -- Execution -----------------------------------------------------------

    def get_execution(self) -> MissionExecutionState:
        state = self._execution.get_state()
        if state is None:
            raise NoCurrentMissionError("No current mission is set")
        return state

    def start(self) -> MissionExecutionState:
        result = self._execution.start()
        self._anomaly_response.begin_run()
        self._drive.advance()
        return result

    def pause(self) -> MissionExecutionState:
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
        result = self._execution.resume()
        self._anomaly_response.dispatch_pending()  # anomalies queued while paused
        self._drive.advance()
        return result

    def stop(self) -> MissionExecutionState:
        result = self._execution.stop()
        self._drive.abort()
        self._anomaly_response.end_run("mission_stopped")
        self._drive.advance()  # drives the return to waypoint 0 (RETURNING_HOME)
        return result

    # -- Helpers -------------------------------------------------------------

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
