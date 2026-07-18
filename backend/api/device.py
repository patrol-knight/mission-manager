from fastapi import APIRouter, HTTPException, Request

from models.device import DeviceView

router = APIRouter()


@router.get("", response_model=list[DeviceView])
def list_devices(request: Request) -> list[DeviceView]:
    return request.app.state.device_registry.list_devices()


@router.get("/{device_id}", response_model=DeviceView)
def get_device(device_id: str, request: Request) -> DeviceView:
    device = request.app.state.device_registry.get(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")
    return device
