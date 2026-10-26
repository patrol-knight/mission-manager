import logging
from dataclasses import dataclass
from pathlib import Path

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.anomaly_repository import AnomalyRepository, RecordingContext, file_hash
from core.camera_registry import CameraRegistry
from core.camera_stream import CameraStreamService
from core.device_registry import DeviceRegistry
from core.errors import MapUnavailableError
from core.heatmap_service import HeatmapService
from core.investigation import InvestigationCoordinator
from core.map_server import MapServer
from core.mission_drive import MissionDriveCoordinator
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.mission_service import MissionService
from core.websocket_manager import WebSocketManager
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)


@dataclass
class Services:
    """Every long-lived service, built once at startup. Routers reach these
    through api/deps.py; they should call the use-case services
    (mission_service, camera_stream, investigation) rather
    than sequencing the lower-level ones themselves."""

    map_server: MapServer
    mission_server: MissionServer
    mission_execution_manager: MissionExecutionManager
    device_registry: DeviceRegistry
    camera_registry: CameraRegistry
    anomaly_registry: AnomalyRegistry
    anomaly_repository: AnomalyRepository | None
    heatmap_service: HeatmapService
    investigation: InvestigationCoordinator
    mission_drive_coordinator: MissionDriveCoordinator
    mission_service: MissionService
    camera_stream: CameraStreamService
    websocket_manager: WebSocketManager
    zenoh_gateway: ZenohGateway


def build_services(settings: Settings) -> Services:
    map_name = settings.map_name or Path(settings.map_osm_path).stem
    map_server = MapServer()
    try:
        map_server.load(settings.map_osm_path, settings.map_projector_path, map_name)
    except MapUnavailableError as exc:
        logger.warning("%s; map endpoints will return 503", exc)

    mission_server = MissionServer(settings.mission_folder, settings.app_state_path)
    mission_server.load()

    device_registry = DeviceRegistry()
    camera_registry = CameraRegistry()

    anomaly_repository: AnomalyRepository | None = None
    if settings.database_url:
        anomaly_repository = AnomalyRepository(
            settings.database_url,
            RecordingContext(
                map_name=map_name,
                source=settings.anomaly_source,
                map_hash=file_hash(settings.map_osm_path),
            ),
        )
        try:
            anomaly_repository.init_schema()
        except Exception:
            logger.warning("Failed to initialize anomaly history schema; continuing without it", exc_info=True)
    anomaly_registry = AnomalyRegistry(repository=anomaly_repository)
    heatmap_service = HeatmapService(anomaly_repository, map_server)
    websocket_manager = WebSocketManager()

    mission_execution_manager = MissionExecutionManager(mission_server, websocket_manager, device_registry)
    mission_execution_manager.sync_with_current()

    # zenoh_gateway is constructed before the coordinators: they send
    # commands through it, and it feeds them device state. The investigation
    # and mission drive also need each other. Both cycles are closed after
    # construction with bind_*() calls.
    zenoh_gateway = ZenohGateway(
        settings, device_registry, websocket_manager, anomaly_registry, map_server, camera_registry
    )
    investigation = InvestigationCoordinator(
        anomaly_registry=anomaly_registry,
        mission_execution_manager=mission_execution_manager,
        map_server=map_server,
        device_registry=device_registry,
        zenoh_gateway=zenoh_gateway,
        websocket_manager=websocket_manager,
    )
    mission_drive_coordinator = MissionDriveCoordinator(
        mission_execution_manager=mission_execution_manager,
        mission_server=mission_server,
        map_server=map_server,
        device_registry=device_registry,
        zenoh_gateway=zenoh_gateway,
        websocket_manager=websocket_manager,
        settings=settings,
    )
    investigation.bind_mission_drive(mission_drive_coordinator)
    mission_drive_coordinator.bind_investigation(investigation)
    zenoh_gateway.bind_coordinators(investigation, mission_drive_coordinator)

    camera_stream = CameraStreamService(settings, device_registry, camera_registry, zenoh_gateway, websocket_manager)
    zenoh_gateway.bind_camera_sessions(camera_stream)

    mission_service = MissionService(
        mission_server=mission_server,
        map_server=map_server,
        execution_manager=mission_execution_manager,
        mission_drive=mission_drive_coordinator,
        investigation=investigation,
        device_registry=device_registry,
        zenoh_gateway=zenoh_gateway,
        websocket_manager=websocket_manager,
    )

    return Services(
        map_server=map_server,
        mission_server=mission_server,
        mission_execution_manager=mission_execution_manager,
        device_registry=device_registry,
        camera_registry=camera_registry,
        anomaly_registry=anomaly_registry,
        anomaly_repository=anomaly_repository,
        heatmap_service=heatmap_service,
        investigation=investigation,
        mission_drive_coordinator=mission_drive_coordinator,
        mission_service=mission_service,
        camera_stream=camera_stream,
        websocket_manager=websocket_manager,
        zenoh_gateway=zenoh_gateway,
    )
