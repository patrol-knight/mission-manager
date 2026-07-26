import logging
from dataclasses import dataclass

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.anomaly_response import AnomalyResponseCoordinator
from core.device_registry import DeviceRegistry
from core.errors import MapUnavailableError
from core.map_server import MapServer
from core.mission_drive import MissionDriveCoordinator
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)


@dataclass
class Services:
    map_server: MapServer
    mission_server: MissionServer
    mission_execution_manager: MissionExecutionManager
    device_registry: DeviceRegistry
    anomaly_registry: AnomalyRegistry
    anomaly_response_coordinator: AnomalyResponseCoordinator
    mission_drive_coordinator: MissionDriveCoordinator
    websocket_manager: WebSocketManager
    zenoh_gateway: ZenohGateway


def build_services(settings: Settings) -> Services:
    map_server = MapServer()
    try:
        map_server.load(settings.map_osm_path, settings.map_projector_path)
    except MapUnavailableError as exc:
        logger.warning("%s; map endpoints will return 503", exc)

    mission_server = MissionServer(settings.mission_folder, settings.app_state_path)
    mission_server.load()

    device_registry = DeviceRegistry()
    anomaly_registry = AnomalyRegistry()
    websocket_manager = WebSocketManager()

    mission_execution_manager = MissionExecutionManager(mission_server, websocket_manager, device_registry)
    mission_execution_manager.sync_with_current()

    # zenoh_gateway is constructed before the two coordinators below
    # both need it to send commands through, and it needs them for its own
    # ingest callbacks, so the two directions are wired up after the fact
    # via bind_coordinators()/bind_mission_drive() to avoid a construction cycle.
    zenoh_gateway = ZenohGateway(settings, device_registry, websocket_manager, anomaly_registry, map_server)

    anomaly_response_coordinator = AnomalyResponseCoordinator(
        anomaly_registry=anomaly_registry,
        mission_execution_manager=mission_execution_manager,
        mission_server=mission_server,
        map_server=map_server,
        device_registry=device_registry,
        websocket_manager=websocket_manager,
        zenoh_gateway=zenoh_gateway,
        settings=settings,
    )

    mission_drive_coordinator = MissionDriveCoordinator(
        mission_execution_manager=mission_execution_manager,
        mission_server=mission_server,
        device_registry=device_registry,
        anomaly_response_coordinator=anomaly_response_coordinator,
        zenoh_gateway=zenoh_gateway,
        websocket_manager=websocket_manager,
        settings=settings,
    )
    anomaly_response_coordinator.bind_mission_drive(mission_drive_coordinator)
    zenoh_gateway.bind_coordinators(anomaly_response_coordinator, mission_drive_coordinator)

    return Services(
        map_server=map_server,
        mission_server=mission_server,
        mission_execution_manager=mission_execution_manager,
        device_registry=device_registry,
        anomaly_registry=anomaly_registry,
        anomaly_response_coordinator=anomaly_response_coordinator,
        mission_drive_coordinator=mission_drive_coordinator,
        websocket_manager=websocket_manager,
        zenoh_gateway=zenoh_gateway,
    )
