import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from api.deps import get_services
from bootstrap import Services
from core.history_devtools import Source, SourceFilter

router = APIRouter()


class SessionPatch(BaseModel):
    excluded: bool | None = None
    source: Source | None = None
    label: str | None = Field(default=None, max_length=80)


class PurgeRequest(BaseModel):
    source: Source = "sim"
    older_than_days: float = Field(ge=0)


class SeedRequest(BaseModel):
    source: Source = "sim"
    sessions: int = Field(default=6, ge=1, le=50)
    anomalies_per_session: int = Field(default=40, ge=1, le=1000)
    days: float = Field(default=45, gt=0, le=365)
    hotspots: int = Field(default=4, ge=1, le=20)
    hotspot_share: float = Field(default=0.65, ge=0, le=1)
    seed: int | None = None


class ScenarioRequest(BaseModel):
    yaml: str = Field(max_length=100_000)


@router.get("/status")
def get_status(services: Services = Depends(get_services)) -> dict:
    return services.history.status()


@router.get("/sessions")
def list_sessions(services: Services = Depends(get_services)) -> list[dict]:
    return services.history.sessions()


@router.patch("/sessions/{session_id}", status_code=204)
def update_session(session_id: uuid.UUID, patch: SessionPatch, services: Services = Depends(get_services)) -> None:
    services.history.update_session(session_id, patch.model_dump(exclude_none=True))


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: uuid.UUID, services: Services = Depends(get_services)) -> None:
    services.history.delete_session(session_id)


@router.post("/purge")
def purge(request: PurgeRequest, services: Services = Depends(get_services)) -> dict:
    return services.history.purge(request.source, request.older_than_days)


@router.post("/seed")
def seed(request: SeedRequest, services: Services = Depends(get_services)) -> dict:
    return services.history.seed(**request.model_dump())


@router.get("/scenarios")
def list_scenarios(services: Services = Depends(get_services)) -> list[dict]:
    return services.history.scenarios()


@router.post("/scenario")
def load_scenario(request: ScenarioRequest, services: Services = Depends(get_services)) -> dict:
    return services.history.load_scenario(request.yaml)


@router.get("/export.csv", response_class=Response)
def export_csv(
    map_name: str | None = None,
    source: Source | None = None,
    session_id: uuid.UUID | None = None,
    services: Services = Depends(get_services),
) -> Response:
    body = services.history.export_csv(map_name, source, session_id)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return Response(
        body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="anomaly-history-{stamp}.csv"'},
    )


@router.get("/heatmap")
def heatmap(
    model: Literal["demand", "density"] = "demand",
    source: SourceFilter = "sim",
    include_excluded: bool = False,
    bandwidth_m: float = Query(4.0, gt=0, le=50),
    half_life_days: float = Query(21.0, ge=0),
    prior_hours: float = Query(2.0, ge=0),
    floor_per_hour: float = Query(0.05, gt=0),
    ceiling_per_hour: float = Query(5.0, gt=0),
    per_device: bool = True,
    use_confidence: bool = True,
    w_true_positive: float = Query(1.0, ge=0),
    w_unclear: float = Query(0.7, ge=0),
    w_expired: float = Query(0.5, ge=0),
    w_false_positive: float = Query(0.05, ge=0),
    services: Services = Depends(get_services),
) -> dict:
    return services.history.heatmap(
        model=model,
        source=source,
        include_excluded=include_excluded,
        bandwidth_m=bandwidth_m,
        half_life_days=half_life_days,
        prior_hours=prior_hours,
        floor_per_hour=floor_per_hour,
        ceiling_per_hour=ceiling_per_hour,
        per_device=per_device,
        use_confidence=use_confidence,
        weights=(w_true_positive, w_unclear, w_expired, w_false_positive),
    )


@router.get("/devices")
def devices(
    source: SourceFilter = "sim", include_excluded: bool = False, services: Services = Depends(get_services)
) -> dict:
    return services.history.devices(source, include_excluded)
