from fastapi import APIRouter, Depends

from api.deps import get_services
from bootstrap import Services
from models.geofence import GeofenceSet

router = APIRouter()


@router.get("", response_model=GeofenceSet)
def get_geofences(services: Services = Depends(get_services)) -> GeofenceSet:
    return services.geofences.zones()


@router.put("", response_model=GeofenceSet)
def replace_geofences(body: GeofenceSet, services: Services = Depends(get_services)) -> GeofenceSet:
    """Replaces every zone of the loaded map. Anomaly Detection gets them the
    next time it asks."""
    return services.geofences.replace(body)
