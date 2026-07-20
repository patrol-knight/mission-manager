from fastapi import APIRouter, HTTPException, Request

from core.errors import (
    InsufficientWaypointsError,
    InvalidExecutionTransitionError,
    NoCurrentMissionError,
)
from models.mission_execution import MissionExecutionState

router = APIRouter()


def _manager(request: Request):
    return request.app.state.mission_execution_manager


@router.get("/current/execution", response_model=MissionExecutionState)
def get_execution_state(request: Request) -> MissionExecutionState:
    state = _manager(request).get_state()
    if state is None:
        raise HTTPException(status_code=404, detail="No current mission is set")
    return state


@router.post("/current/start", response_model=MissionExecutionState)
def start_mission(request: Request) -> MissionExecutionState:
    try:
        return _manager(request).start()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientWaypointsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/current/pause", response_model=MissionExecutionState)
def pause_mission(request: Request) -> MissionExecutionState:
    try:
        return _manager(request).pause()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/current/resume", response_model=MissionExecutionState)
def resume_mission(request: Request) -> MissionExecutionState:
    try:
        return _manager(request).resume()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/current/stop", response_model=MissionExecutionState)
def stop_mission(request: Request) -> MissionExecutionState:
    try:
        return _manager(request).stop()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
