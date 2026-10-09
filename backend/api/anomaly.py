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


@router.post("/{anomaly_id}/verify", response_model=Anomaly)
def verify_anomaly(anomaly_id: str, services: Services = Depends(get_services)) -> Anomaly:
    """Operator confirmed the anomaly is real after inspecting the robot's
    camera feed."""
    return services.anomaly_response_coordinator.resolve_anomaly(anomaly_id, "true_positive")


@router.post("/{anomaly_id}/dismiss", response_model=Anomaly)
def dismiss_anomaly(anomaly_id: str, services: Services = Depends(get_services)) -> Anomaly:
    """Operator judged the anomaly a false positive after inspecting the
    robot's camera feed."""
    return services.anomaly_response_coordinator.resolve_anomaly(anomaly_id, "false_positive")
