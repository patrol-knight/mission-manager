from fastapi import APIRouter, Depends, Response, status

from api.deps import get_services
from bootstrap import Services
from models.mission import Mission, MissionGeo, MissionSummary
from models.mission_execution import MissionExecutionState

router = APIRouter()


@router.get("", response_model=list[MissionSummary])
def list_missions(services: Services = Depends(get_services)) -> list[MissionSummary]:
    return services.mission_service.list_missions()


@router.post("", response_model=MissionGeo)
def create_mission(mission: Mission, services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.create_mission(mission)


# Literal paths before "/{mission_id}" so they aren't captured as an id.
@router.get("/current", response_model=MissionGeo)
def get_current_mission(services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.get_current()


@router.get("/default", response_model=MissionGeo)
def get_default_mission(services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.get_default()


@router.get("/current/execution", response_model=MissionExecutionState)
def get_execution_state(services: Services = Depends(get_services)) -> MissionExecutionState:
    return services.mission_service.get_execution()


@router.post("/current/start", response_model=MissionExecutionState)
def start_mission(services: Services = Depends(get_services)) -> MissionExecutionState:
    return services.mission_service.start()


@router.post("/current/pause", response_model=MissionExecutionState)
def pause_mission(services: Services = Depends(get_services)) -> MissionExecutionState:
    return services.mission_service.pause()


@router.post("/current/resume", response_model=MissionExecutionState)
def resume_mission(services: Services = Depends(get_services)) -> MissionExecutionState:
    return services.mission_service.resume()


@router.post("/current/stop", response_model=MissionExecutionState)
def stop_mission(services: Services = Depends(get_services)) -> MissionExecutionState:
    return services.mission_service.stop()


@router.get("/{mission_id}", response_model=MissionGeo)
def get_mission(mission_id: str, services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.get_mission(mission_id)


@router.put("/{mission_id}", response_model=MissionGeo)
def update_mission(mission_id: str, mission: Mission, services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.update_mission(mission_id, mission)


@router.delete("/{mission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mission(mission_id: str, services: Services = Depends(get_services)) -> Response:
    services.mission_service.delete_mission(mission_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{mission_id}/activate", response_model=MissionGeo)
def activate_mission(mission_id: str, services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.activate(mission_id)


@router.post("/{mission_id}/set-default", response_model=MissionGeo)
def set_default_mission(mission_id: str, services: Services = Depends(get_services)) -> MissionGeo:
    return services.mission_service.set_default(mission_id)
