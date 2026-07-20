from fastapi import APIRouter, HTTPException, Request

from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import Anomaly

router = APIRouter()


def _registry(request: Request):
    return request.app.state.anomaly_registry


@router.get("", response_model=list[Anomaly])
def list_anomalies(request: Request) -> list[Anomaly]:
    return _registry(request).list()


@router.get("/{anomaly_id}", response_model=Anomaly)
def get_anomaly(anomaly_id: str, request: Request) -> Anomaly:
    anomaly = _registry(request).get(anomaly_id)
    if anomaly is None:
        raise HTTPException(status_code=404, detail=f"Anomaly not found: {anomaly_id}")
    return anomaly


@router.post("/{anomaly_id}/verify", response_model=Anomaly)
def verify_anomaly(anomaly_id: str, request: Request) -> Anomaly:
    try:
        verified = _registry(request).verify(anomaly_id)
    except AnomalyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidAnomalyTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    request.app.state.websocket_manager.broadcast_threadsafe(
        {"type": "anomaly.updated", "data": verified.model_dump(mode="json")}
    )
    return verified
