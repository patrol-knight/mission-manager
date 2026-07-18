import logging
from dataclasses import dataclass

from config import Settings
from core.device_registry import DeviceRegistry
from core.errors import MapUnavailableError
from core.map_server import MapServer
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)


@dataclass
class Services:
    map_server: MapServer
    mission_server: MissionServer
    device_registry: DeviceRegistry
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
    websocket_manager = WebSocketManager()
    zenoh_gateway = ZenohGateway(settings, device_registry, websocket_manager)

    return Services(
        map_server=map_server,
        mission_server=mission_server,
        device_registry=device_registry,
        websocket_manager=websocket_manager,
        zenoh_gateway=zenoh_gateway,
    )
