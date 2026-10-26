import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import anomaly as anomaly_api
from api import camera as camera_api
from api import device as device_api
from api import investigation as investigation_api
from api import map as map_api
from api import mission as mission_api
from api import system as system_api
from api import websocket as websocket_api
from api.errors import register_error_handlers
from bootstrap import build_services
from config import Settings
from core.anomaly_repository import DeviceSample
from core.monitor import run_monitor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SESSION_HEARTBEAT_SEC = 60.0


async def heartbeat_sessions(repository, device_registry) -> None:
    while True:
        await asyncio.sleep(SESSION_HEARTBEAT_SEC)
        devices = [
            DeviceSample(d.device_id, d.type.value, d.pose.x, d.pose.y)
            for d in device_registry.list_devices() if d.connected
        ]
        await asyncio.to_thread(repository.heartbeat, devices)


def create_app(settings: Settings | None = None) -> FastAPI:
    """`settings` defaults to the environment / .env; tests pass their own
    (e.g. a temporary storage folder)."""
    settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        services = build_services(settings)
        app.state.services = services

        services.websocket_manager.bind_loop(asyncio.get_running_loop())

        if settings.zenoh_enabled:
            try:
                services.zenoh_gateway.start()
            except Exception:
                logger.error("Failed to start Zenoh gateway; continuing without it", exc_info=True)

        monitor_task = asyncio.create_task(
            run_monitor(
                services.device_registry,
                services.anomaly_registry,
                services.mission_service,
                services.websocket_manager,
                settings.device_offline_timeout_sec,
                settings.robot_lost_grace_sec,
                settings.device_monitor_interval_sec,
            )
        )

        heartbeat_task = (
            asyncio.create_task(heartbeat_sessions(services.anomaly_repository, services.device_registry))
            if services.anomaly_repository is not None
            else None
        )

        logger.info("[Backend] Started")
        try:
            yield
        finally:
            if heartbeat_task is not None:
                heartbeat_task.cancel()
            monitor_task.cancel()
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
            services.zenoh_gateway.stop()
            if services.anomaly_repository is not None:
                services.anomaly_repository.close()
            logger.info("[Backend] Stopped")

    fastapi_app = FastAPI(lifespan=lifespan)

    allow_credentials = "*" not in settings.cors_origins
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_error_handlers(fastapi_app)

    fastapi_app.include_router(mission_api.router, prefix="/api/missions", tags=["missions"])
    fastapi_app.include_router(device_api.router, prefix="/api/devices", tags=["devices"])
    fastapi_app.include_router(anomaly_api.router, prefix="/api/anomalies", tags=["anomalies"])
    fastapi_app.include_router(investigation_api.router, prefix="/api/investigation", tags=["investigation"])
    fastapi_app.include_router(map_api.router, prefix="/api/map", tags=["map"])
    fastapi_app.include_router(camera_api.router, prefix="/api/cameras", tags=["cameras"])
    fastapi_app.include_router(system_api.router, prefix="/api/system", tags=["system"])
    fastapi_app.include_router(websocket_api.router, tags=["websocket"])

    return fastapi_app


app = create_app()
