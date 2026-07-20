import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import anomaly as anomaly_api
from api import camera as camera_api
from api import device as device_api
from api import map as map_api
from api import mission as mission_api
from api import mission_execution as mission_execution_api
from api import websocket as websocket_api
from bootstrap import Services, build_services
from config import Settings
from core.device_registry import DeviceRegistry
from core.websocket_manager import WebSocketManager
from simulation.dev_simulator import DevSimulator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings()


async def monitor_devices(
    registry: DeviceRegistry,
    websocket_manager: WebSocketManager,
    timeout_sec: float,
    interval_sec: float,
) -> None:
    while True:
        changed = registry.mark_offline_devices(timeout_sec)
        if changed:
            await websocket_manager.broadcast(
                {
                    "type": "devices.snapshot",
                    "data": [d.model_dump(mode="json") for d in registry.list_devices()],
                }
            )
        await asyncio.sleep(interval_sec)


async def run_dev_simulator(simulator: DevSimulator, tick_interval_sec: float) -> None:
    while True:
        try:
            simulator.tick()
        except Exception:
            logger.exception("Dev simulator tick failed")
        await asyncio.sleep(tick_interval_sec)


@asynccontextmanager
async def lifespan(app: FastAPI):
    services: Services = build_services(settings)

    app.state.settings = settings
    app.state.map_server = services.map_server
    app.state.mission_server = services.mission_server
    app.state.mission_execution_manager = services.mission_execution_manager
    app.state.device_registry = services.device_registry
    app.state.anomaly_registry = services.anomaly_registry
    app.state.websocket_manager = services.websocket_manager
    app.state.zenoh_gateway = services.zenoh_gateway

    services.websocket_manager.bind_loop(asyncio.get_running_loop())

    if settings.zenoh_enabled:
        services.zenoh_gateway.start()

    monitor_task = asyncio.create_task(
        monitor_devices(
            services.device_registry,
            services.websocket_manager,
            settings.device_offline_timeout_sec,
            settings.device_monitor_interval_sec,
        )
    )

    simulator_task = None
    if settings.simulator_enabled:
        simulator_task = asyncio.create_task(
            run_dev_simulator(services.dev_simulator, settings.simulator_tick_interval_sec)
        )

    logger.info("[Backend] Started")
    try:
        yield
    finally:
        monitor_task.cancel()
        try:
            await monitor_task
        except asyncio.CancelledError:
            pass
        if simulator_task is not None:
            simulator_task.cancel()
            try:
                await simulator_task
            except asyncio.CancelledError:
                pass
        services.zenoh_gateway.stop()
        logger.info("[Backend] Stopped")


def create_app() -> FastAPI:
    fastapi_app = FastAPI(lifespan=lifespan)

    allow_credentials = "*" not in settings.cors_origins
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    fastapi_app.include_router(mission_api.router, prefix="/api/missions", tags=["missions"])
    fastapi_app.include_router(
        mission_execution_api.router, prefix="/api/missions", tags=["missions", "execution"]
    )
    fastapi_app.include_router(device_api.router, prefix="/api/devices", tags=["devices"])
    fastapi_app.include_router(anomaly_api.router, prefix="/api/anomalies", tags=["anomalies"])
    fastapi_app.include_router(map_api.router, prefix="/api/map", tags=["map"])
    fastapi_app.include_router(camera_api.router, prefix="/api/cameras", tags=["cameras"])
    fastapi_app.include_router(websocket_api.router, tags=["websocket"])

    return fastapi_app


app = create_app()
