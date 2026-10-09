from fastapi import APIRouter, HTTPException, Request

from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import Anomaly

router = APIRouter()


def _registry(request: Request):
    return request.app.state.anomaly_registry


def _after_resolve(request: Request, anomaly: Anomaly) -> None:
    """Shared tail of verify/dismiss: tell Anomaly Detection the verdict,
    move the robot on, and push the resolved anomaly to clients."""
    request.app.state.zenoh_gateway.publish_anomaly_feedback(
        anomaly.anomaly_id, anomaly.resolution, anomaly.resolved_at
    )
    request.app.state.anomaly_response_coordinator.resolve(anomaly.anomaly_id)
    request.app.state.websocket_manager.broadcast_threadsafe(
        {"type": "anomaly.updated", "data": anomaly.model_dump(mode="json")}
    )


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

    _after_resolve(request, verified)
    return verified


@router.post("/{anomaly_id}/dismiss", response_model=Anomaly)
def dismiss_anomaly(anomaly_id: str, request: Request) -> Anomaly:
    """Operator inspected the robot's camera feed (AnomalyVerifyModal.tsx)
    and judged the anomaly a false positive -- see AnomalyRegistry._resolve's
    docstring. Same feedback and return-to-mission trigger as verify()."""
    try:
        dismissed = _registry(request).dismiss(anomaly_id)
    except AnomalyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidAnomalyTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    _after_resolve(request, dismissed)
    return dismissed
