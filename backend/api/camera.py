from fastapi import APIRouter, Depends, Response

from api.deps import get_services
from bootstrap import Services

router = APIRouter()


@router.post("/{device_id}/{camera_id}/stream", status_code=202)
def start_camera_stream(device_id: str, camera_id: str, services: Services = Depends(get_services)) -> dict:
    """Kicks off WebRTC negotiation for one camera; the signaling itself
    then rides the WebSocket (see core/camera_stream.py)."""
    return {"session_id": services.camera_stream.start(device_id, camera_id)}


@router.post("/{device_id}/{camera_id}/stream/{session_id}/stop", status_code=204)
def stop_camera_stream(
    device_id: str, camera_id: str, session_id: str, services: Services = Depends(get_services)
) -> Response:
    """session_id isn't needed to identify the stream server-side (one
    active stream per camera) -- it's in the path to mirror the session
    start_camera_stream handed back."""
    services.camera_stream.stop(device_id, camera_id)
    return Response(status_code=204)
