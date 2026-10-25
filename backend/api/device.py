from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_services
from bootstrap import Services
from models.device import DeviceView

router = APIRouter()


@router.get("", response_model=list[DeviceView])
def list_devices(services: Services = Depends(get_services)) -> list[DeviceView]:
    return services.device_registry.list_devices()


@router.get("/{device_id}", response_model=DeviceView)
def get_device(device_id: str, services: Services = Depends(get_services)) -> DeviceView:
    device = services.device_registry.get(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")
    return device
