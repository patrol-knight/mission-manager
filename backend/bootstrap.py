import logging
from dataclasses import dataclass

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import MapUnavailableError
from core.map_server import MapServer
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from simulation.dev_simulator import DevSimulator
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)


@dataclass
class Services:
    map_server: MapServer
    mission_server: MissionServer
    mission_execution_manager: MissionExecutionManager
    device_registry: DeviceRegistry
    anomaly_registry: AnomalyRegistry
    websocket_manager: WebSocketManager
    zenoh_gateway: ZenohGateway
    dev_simulator: DevSimulator


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
    zenoh_gateway = ZenohGateway(settings, device_registry, websocket_manager)

    mission_execution_manager = MissionExecutionManager(mission_server, websocket_manager)
    mission_execution_manager.sync_with_current()

    dev_simulator = DevSimulator(
        settings,
        mission_server,
        mission_execution_manager,
        device_registry,
        anomaly_registry,
        websocket_manager,
    )

    if settings.zenoh_enabled and settings.simulator_enabled:
        logger.warning(
            "Both ZENOH_ENABLED and SIMULATOR_ENABLED are true — the dev simulator's "
            "device ids (%s, %s) must not collide with real Zenoh-published device ids, "
            "or their updates will overwrite each other in DeviceRegistry.",
            settings.simulator_robot_device_id,
            settings.simulator_iot_device_ids,
        )

    return Services(
        map_server=map_server,
        mission_server=mission_server,
        mission_execution_manager=mission_execution_manager,
        device_registry=device_registry,
        anomaly_registry=anomaly_registry,
        websocket_manager=websocket_manager,
        zenoh_gateway=zenoh_gateway,
        dev_simulator=dev_simulator,
    )
