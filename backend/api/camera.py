from fastapi import APIRouter, Depends, Response

from api.deps import get_services
from bootstrap import Services

router = APIRouter()


@router.post("/{device_id}/{camera_id}/stream", status_code=202)
def start_camera_stream(
    device_id: str, camera_id: str, connection_id: str | None = None, services: Services = Depends(get_services)
) -> dict:
    """Kicks off WebRTC negotiation for one camera; the signaling then rides
    the WebSocket, to `connection_id` (from connection.ready) only."""
    return {"session_id": services.camera_stream.start(device_id, camera_id, connection_id)}


@router.post("/{device_id}/{camera_id}/stream/{session_id}/stop", status_code=204)
def stop_camera_stream(
    device_id: str, camera_id: str, session_id: str, services: Services = Depends(get_services)
) -> Response:
    services.camera_stream.stop(device_id, camera_id, session_id)
    return Response(status_code=204)
