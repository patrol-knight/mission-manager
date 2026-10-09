import asyncio

from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.investigation import InvestigationCoordinator
from core.websocket_manager import WebSocketManager


async def run_monitor(
    device_registry: DeviceRegistry,
    anomaly_registry: AnomalyRegistry,
    investigation: InvestigationCoordinator,
    websocket_manager: WebSocketManager,
    offline_timeout_sec: float,
    interval_sec: float,
) -> None:
    """Periodic housekeeping, every `interval_sec` until cancelled: marks
    silent devices offline, cancels an investigation whose robot went offline, and
    expires anomalies whose grace period ran out."""
    while True:
        if device_registry.mark_offline_devices(offline_timeout_sec):
            await websocket_manager.broadcast(
                {
                    "type": "devices.snapshot",
                    "data": [d.model_dump(mode="json") for d in device_registry.list_devices()],
                }
            )
        investigation.abort_if_robot_disconnected()
        # Off the event loop: expire() writes expired anomalies to Postgres,
        # which can block on an unreachable database.
        for anomaly_id in await asyncio.to_thread(anomaly_registry.expire):
            await websocket_manager.broadcast({"type": "anomaly.expired", "data": {"anomaly_id": anomaly_id}})
        await asyncio.sleep(interval_sec)
