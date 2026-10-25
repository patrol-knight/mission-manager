from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from api.deps import get_services
from bootstrap import Services
from models.camera import CameraSessionInfo, StartCameraStreamRequest, StopCameraStreamRequest

router = APIRouter()


@router.post("/{device_id}/{camera_id}/stream", status_code=201)
async def start_camera_stream(
    device_id: str,
    camera_id: str,
    body: StartCameraStreamRequest,
    services: Services = Depends(get_services),
) -> CameraSessionInfo:
    """Admits one viewer session (frontend-generated session_id) for the
    camera, owned by the WebSocket connection named in the body. 201 means
    the device gateway admitted it and negotiation is under way -- not that
    video is flowing yet; the SDP/ICE exchange then rides the WebSocket.
    409 camera_busy/session_stopping, 503 device unavailable, 504 if the
    gateway gave no answer in time (the backend then cancels the session
    itself)."""
    return await services.camera_stream.start(device_id, camera_id, body)


@router.post("/{device_id}/{camera_id}/stream/{session_id}/stop", status_code=204)
async def stop_camera_stream(
    device_id: str,
    camera_id: str,
    session_id: str,
    request: Request,
    services: Services = Depends(get_services),
) -> Response:
    """Stops the session if `connection_id` owns it. 204 once the gateway
    confirmed it's gone; 202 if it's stopping but unconfirmed yet.

    The JSON body is parsed whatever its Content-Type: a closing page's
    navigator.sendBeacon() sends it as text/plain, the only way it can reach
    a cross-origin API without a CORS preflight a beacon can't do."""
    try:
        body = StopCameraStreamRequest.model_validate_json(await request.body())
    except ValidationError as exc:
        return JSONResponse(status_code=422, content={"detail": exc.errors(include_url=False, include_input=False)})
    confirmed = await services.camera_stream.stop(device_id, camera_id, session_id, body.connection_id)
    if confirmed:
        return Response(status_code=204)
    return JSONResponse(status_code=202, content={"session_id": session_id, "status": "stopping"})
