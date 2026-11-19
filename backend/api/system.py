from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services

router = APIRouter()


@router.get("/status")
def get_system_status(services: Services = Depends(get_services)) -> dict:
    map_server = services.map_server
    return {"map": map_server.get_info().map_name if map_server.is_available() else None}
