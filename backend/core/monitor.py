import asyncio

from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.mission_service import MissionService
from core.websocket_manager import WebSocketManager


async def run_monitor(
    device_registry: DeviceRegistry,
    anomaly_registry: AnomalyRegistry,
    mission_service: MissionService,
    websocket_manager: WebSocketManager,
    offline_timeout_sec: float,
    robot_lost_grace_sec: float,
    interval_sec: float,
) -> None:
    """Periodic housekeeping, every `interval_sec` until cancelled: marks
    silent devices offline, aborts the mission and investigation once the
    robot has been lost for longer than its grace period, and expires
    anomalies whose grace period ran out."""
    while True:
        for device in device_registry.mark_offline_devices(offline_timeout_sec):
            await websocket_manager.broadcast({"type": "device.updated", "data": device.model_dump(mode="json")})
        mission_service.abort_if_robot_lost(robot_lost_grace_sec)
        # Off the event loop: expire() writes expired anomalies to Postgres,
        # which can block on an unreachable database.
        for anomaly_id in await asyncio.to_thread(anomaly_registry.expire):
            await websocket_manager.broadcast({"type": "anomaly.expired", "data": {"anomaly_id": anomaly_id}})
        await asyncio.sleep(interval_sec)
