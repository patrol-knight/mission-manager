import time

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from api.deps import get_services, get_ws_services
from bootstrap import Services

router = APIRouter()


class StartRun(BaseModel):
    label: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=2000)


class PingTarget(BaseModel):
    ip: str | None = Field(default=None, max_length=64)


@router.get("/status")
def get_status(services: Services = Depends(get_services)) -> dict:
    return services.devtools.status()


@router.get("/runs")
def list_runs(services: Services = Depends(get_services)) -> list[dict]:
    return services.devtools.recorder.list_runs()


@router.post("/runs")
def start_run(body: StartRun, services: Services = Depends(get_services)) -> dict:
    try:
        run_id = services.devtools.start_recording(body.label, body.notes)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"run_id": run_id}


@router.post("/runs/stop")
def stop_run(services: Services = Depends(get_services)) -> dict:
    return {"run_id": services.devtools.stop_recording()}


@router.put("/targets/{device_id}")
def set_ping_target(device_id: str, body: PingTarget, services: Services = Depends(get_services)) -> dict:
    """Overrides the IP found from the Zenoh router; null clears it."""
    if body.ip:
        services.devtools.manual_ips[device_id] = body.ip
    else:
        services.devtools.manual_ips.pop(device_id, None)
    return services.devtools.status()


@router.websocket("/ws")
async def devtools_ws(websocket: WebSocket) -> None:
    devtools = get_ws_services(websocket).devtools
    await websocket.accept()
    devtools.add_client(websocket)
    try:
        while True:
            try:
                message = await websocket.receive_json()
            except WebSocketDisconnect:
                break
            except Exception:
                continue
            if not isinstance(message, dict):
                continue
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong", "t": message.get("t"), "server_time": time.time()})
            elif message.get("type") == "browser":
                devtools.record_browser(message)
    finally:
        devtools.remove_client(websocket)
