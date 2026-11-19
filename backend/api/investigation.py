from fastapi import APIRouter, Depends, Response, status

from api.deps import get_services
from bootstrap import Services
from models.investigation import (
    GoToPreview,
    GoToRequest,
    InvestigationState,
    SetVerdictRequest,
    StartInvestigationRequest,
)

router = APIRouter()


@router.post("", response_model=InvestigationState)
def start_investigation(
    request: StartInvestigationRequest, services: Services = Depends(get_services)
) -> InvestigationState:
    """Sends the robot to an anomaly, or switches to another one."""
    return services.investigation.start(request.anomaly_id)


@router.put("/verdict", response_model=InvestigationState)
def set_verdict(request: SetVerdictRequest, services: Services = Depends(get_services)) -> InvestigationState:
    return services.investigation.set_verdict(request.verdict)


@router.post("/cancel", status_code=status.HTTP_204_NO_CONTENT)
def cancel_investigation(services: Services = Depends(get_services)) -> Response:
    services.investigation.cancel()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/finish", status_code=status.HTTP_204_NO_CONTENT)
def finish_investigation(services: Services = Depends(get_services)) -> Response:
    services.investigation.finish()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/goto/preview", response_model=GoToPreview)
def preview_go_to(request: GoToRequest, services: Services = Depends(get_services)) -> GoToPreview:
    """Where Go here would send the robot, without sending it."""
    return services.investigation.preview_go_to(request.lat, request.lon)


@router.post("/goto", response_model=InvestigationState)
def go_to(request: GoToRequest, services: Services = Depends(get_services)) -> InvestigationState:
    """Go here: sends the robot to look at a point, or retargets it."""
    return services.investigation.go_to(request.lat, request.lon)
