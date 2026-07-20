import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    manager = websocket.app.state.websocket_manager
    device_registry = websocket.app.state.device_registry
    mission_server = getattr(websocket.app.state, "mission_server", None)
    mission_execution_manager = getattr(websocket.app.state, "mission_execution_manager", None)
    anomaly_registry = getattr(websocket.app.state, "anomaly_registry", None)

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
            await manager.send_json(
                websocket,
                {
                    "type": "mission.current",
                    "data": current.model_dump(mode="json") if current else None,
                },
            )

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
