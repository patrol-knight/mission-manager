from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.post("/{device_id}/session")
def create_camera_session(device_id: str, request: Request) -> dict:
    device = request.app.state.device_registry.get(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")
    if "camera" not in device.capabilities:
        raise HTTPException(
            status_code=400, detail=f"Device has no camera capability: {device_id}"
        )
    raise HTTPException(
        status_code=501,
        detail="Camera/WebRTC session service is not implemented",
    )
