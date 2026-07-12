from fastapi import APIRouter, HTTPException, Request, Response, status

from core.errors import (
    MissionAlreadyExistsError,
    MissionNotFoundError,
    MissionValidationError,
)
from models.mission import Mission, MissionSummary

router = APIRouter()


@router.get("", response_model=list[MissionSummary])
def list_missions(request: Request) -> list[MissionSummary]:
    return request.app.state.mission_server.list_missions()


@router.get("/current", response_model=Mission)
def get_current_mission(request: Request) -> Mission:
    mission = request.app.state.mission_server.get_current()
    if mission is None:
        raise HTTPException(status_code=404, detail="No current mission is set")
    return mission


@router.get("/default", response_model=Mission)
def get_default_mission(request: Request) -> Mission:
    mission = request.app.state.mission_server.get_default()
    if mission is None:
        raise HTTPException(status_code=404, detail="No default mission is set")
    return mission


@router.get("/{mission_id}", response_model=Mission)
def get_mission(mission_id: str, request: Request) -> Mission:
    mission = request.app.state.mission_server.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail=f"Mission not found: {mission_id}")
    return mission


@router.post("", response_model=Mission)
def create_mission(mission: Mission, request: Request) -> Mission:
    try:
        return request.app.state.mission_server.create_mission(mission)
    except MissionAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except MissionValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{mission_id}", response_model=Mission)
def update_mission(mission_id: str, mission: Mission, request: Request) -> Mission:
    try:
        return request.app.state.mission_server.update_mission(mission_id, mission)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MissionValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{mission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mission(mission_id: str, request: Request) -> Response:
    try:
        request.app.state.mission_server.delete_mission(mission_id)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{mission_id}/activate", response_model=Mission)
def activate_mission(mission_id: str, request: Request) -> Mission:
    try:
        return request.app.state.mission_server.activate(mission_id)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{mission_id}/set-default", response_model=Mission)
def set_default_mission(mission_id: str, request: Request) -> Mission:
    try:
        return request.app.state.mission_server.set_default(mission_id)
    except MissionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
