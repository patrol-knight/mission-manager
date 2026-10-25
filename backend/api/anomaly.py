from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_services
from bootstrap import Services
from models.anomaly import Anomaly

router = APIRouter()


@router.get("", response_model=list[Anomaly])
def list_anomalies(services: Services = Depends(get_services)) -> list[Anomaly]:
    return services.anomaly_registry.list()


@router.get("/{anomaly_id}", response_model=Anomaly)
def get_anomaly(anomaly_id: str, services: Services = Depends(get_services)) -> Anomaly:
    anomaly = services.anomaly_registry.get(anomaly_id)
    if anomaly is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    return anomaly
