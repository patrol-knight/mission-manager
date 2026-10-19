import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.deps import get_ws_services
from bootstrap import Services

logger = logging.getLogger(__name__)

router = APIRouter()


def _snapshot_events(services: Services, connection_id: str) -> list[dict]:
    """Everything a freshly-connected client needs to render the current
    state without waiting for the next change event."""
    current = services.mission_service.current_or_none()
    execution = services.mission_execution_manager.get_state()
    devices = [d.model_dump(mode="json") for d in services.device_registry.list_devices()]
    events = [
        # connection_id: what a client quotes to own a camera session
        # (POST .../stream) and to resume it after reconnecting.
        {"type": "connection.ready", "data": {"protocol_version": 2, "connection_id": connection_id}},
        {"type": "devices.snapshot", "data": devices},
        {"type": "mission.current", "data": current.model_dump(mode="json") if current else None},
        {"type": "mission.execution", "data": execution.model_dump(mode="json") if execution else None},
        {"type": "cameras.snapshot", "data": [c.public_view() for c in services.camera_registry.list()]},
        {"type": "anomalies.snapshot", "data": [a.model_dump(mode="json") for a in services.anomaly_registry.list()]},
    ]
    investigation = services.investigation.get_state()
    events.append(
        {"type": "investigation.updated", "data": investigation.model_dump(mode="json") if investigation else None}
    )
    return events


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    services = get_ws_services(websocket)
    manager = services.websocket_manager

    connection_id = await manager.connect(websocket)
    try:
        for event in _snapshot_events(services, connection_id):
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
                # Browser's answer/ICE candidates for a session started via
                # POST /api/cameras/{device}/{camera}/stream -- relayed to the
                # device's gateway only if this connection owns the session.
                data = message.get("data")
                if isinstance(data, dict):
                    error = services.camera_stream.forward_inbound_signal(connection_id, data)
                    if error is not None:
                        await manager.send_json(
                            websocket,
                            {
                                "type": "camera.signal.rejected",
                                "data": {"session_id": data.get("session_id"), "code": error},
                            },
                        )
            elif message.get("type") == "camera.session.resume":
                # A reconnected page reclaiming the signaling of a session
                # its previous connection owned.
                data = message.get("data")
                if isinstance(data, dict) and isinstance(data.get("session_id"), str):
                    previous = data.get("previous_connection_id")
                    error = await services.camera_stream.resume(
                        connection_id, data["session_id"], previous if isinstance(previous, str) else None
                    )
                    reply = {"session_id": data["session_id"]}
                    if error is None:
                        await manager.send_json(websocket, {"type": "camera.session.resumed", "data": reply})
                    else:
                        await manager.send_json(
                            websocket, {"type": "camera.session.resume_failed", "data": reply | {"code": error}}
                        )
            # Unknown message types are ignored without closing the connection.
    finally:
        await manager.disconnect(websocket)
        services.camera_stream.owner_disconnected(connection_id)
