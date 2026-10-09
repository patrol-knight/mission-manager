import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.deps import get_ws_services
from bootstrap import Services

logger = logging.getLogger(__name__)

router = APIRouter()


def _snapshot_events(services: Services) -> list[dict]:
    """Everything a freshly-connected client needs to render the current
    state without waiting for the next change event."""
    current = services.mission_service.current_or_none()
    execution = services.mission_execution_manager.get_state()
    devices = [d.model_dump(mode="json") for d in services.device_registry.list_devices()]
    events = [
        {"type": "connection.ready", "data": {"protocol_version": 1}},
        {"type": "devices.snapshot", "data": devices},
        {"type": "mission.current", "data": current.model_dump(mode="json") if current else None},
        {"type": "mission.execution", "data": execution.model_dump(mode="json") if execution else None},
        {"type": "cameras.snapshot", "data": [c.model_dump(mode="json") for c in services.camera_registry.list()]},
        {"type": "anomalies.snapshot", "data": [a.model_dump(mode="json") for a in services.anomaly_registry.list()]},
    ]
    active = services.anomaly_response_coordinator.get_active()
    if active is not None:
        event_type, data = active
        events.append({"type": event_type, "data": data})
    return events


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    services = get_ws_services(websocket)
    manager = services.websocket_manager

    await manager.connect(websocket)
    try:
        for event in _snapshot_events(services):
            await manager.send_json(websocket, event)

        while True:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except Exception:
                logger.warning("Ignoring malformed WebSocket message")
                continue

            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await manager.send_json(websocket, {"type": "pong"})
            elif message.get("type") == "camera.signal":
                # Browser's answer/ICE candidates for a negotiation started via
                # POST /api/cameras/{device}/{camera}/stream -- relayed to the
                # device's gateway over Zenoh.
                data = message.get("data")
                if isinstance(data, dict):
                    device_id = data.get("device_id")
                    camera_id = data.get("camera_id")
                    if isinstance(device_id, str) and isinstance(camera_id, str):
                        signal = {k: v for k, v in data.items() if k not in ("device_id", "camera_id")}
                        services.zenoh_gateway.publish_camera_signal(device_id, camera_id, signal)
            # Unknown message types are ignored without closing the connection.
    finally:
        await manager.disconnect(websocket)
