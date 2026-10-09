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
from core.monitor import run_monitor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = Settings()


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

    logger.info("[Backend] Started")
    try:
        yield
    finally:
        monitor_task.cancel()
        try:
            await monitor_task
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
