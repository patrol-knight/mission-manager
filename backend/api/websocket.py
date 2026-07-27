import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.mission import _with_geo

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    manager = websocket.app.state.websocket_manager
    device_registry = websocket.app.state.device_registry
    mission_server = getattr(websocket.app.state, "mission_server", None)
    map_server = getattr(websocket.app.state, "map_server", None)
    mission_execution_manager = getattr(websocket.app.state, "mission_execution_manager", None)
    anomaly_registry = getattr(websocket.app.state, "anomaly_registry", None)
    anomaly_response_coordinator = getattr(websocket.app.state, "anomaly_response_coordinator", None)

    await manager.connect(websocket)
    try:
        await manager.send_json(
            websocket, {"type": "connection.ready", "data": {"protocol_version": 1}}
        )
        await manager.send_json(
            websocket,
            {
                "type": "devices.snapshot",
                "data": [
                    d.model_dump(mode="json") for d in device_registry.list_devices()
                ],
            },
        )
        if mission_server is not None:
            current = mission_server.get_current()
            data = None
            if current is not None:
                data = (
                    _with_geo(current, map_server).model_dump(mode="json")
                    if map_server is not None
                    else current.model_dump(mode="json")
                )
            await manager.send_json(websocket, {"type": "mission.current", "data": data})

        if mission_execution_manager is not None:
            execution = mission_execution_manager.get_state()
            await manager.send_json(
                websocket,
                {
                    "type": "mission.execution",
                    "data": execution.model_dump(mode="json") if execution else None,
                },
            )

        if anomaly_registry is not None:
            await manager.send_json(
                websocket,
                {
                    "type": "anomalies.snapshot",
                    "data": [a.model_dump(mode="json") for a in anomaly_registry.list()],
                },
            )

        if anomaly_response_coordinator is not None:
            active = anomaly_response_coordinator.get_active()
            if active is not None:
                event_type, data = active
                await manager.send_json(websocket, {"type": event_type, "data": data})

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
            # Unknown message types are ignored without closing the connection.
    finally:
        await manager.disconnect(websocket)
