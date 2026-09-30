import uuid

from fastapi import APIRouter, HTTPException, Request

from core.errors import (
    InsufficientWaypointsError,
    InvalidExecutionTransitionError,
    NoConnectedRobotError,
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
        result = _manager(request).start()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InsufficientWaypointsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except NoConnectedRobotError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    request.app.state.anomaly_response_coordinator.begin_run()
    request.app.state.mission_drive_coordinator.advance()
    return result


@router.post("/current/pause", response_model=MissionExecutionState)
def pause_mission(request: Request) -> MissionExecutionState:
    try:
        result = _manager(request).pause()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    request.app.state.mission_drive_coordinator.abort()

    # Backend bookkeeping stopping isn't enough on its own -- the robot has
    # no concept of "pause" and will keep driving toward its last goal
    # unless explicitly told to stop (see device_gateway's
    # NavigationGatewayComponent / dummy_robot_node.py's cancel_navigation).
    robot = request.app.state.device_registry.get_connected_robot()
    if robot is not None:
        request.app.state.zenoh_gateway.publish_command(
            robot.device_id, "cancel_navigation", request_id=f"pause-{uuid.uuid4().hex[:8]}"
        )

    return result


@router.post("/current/resume", response_model=MissionExecutionState)
def resume_mission(request: Request) -> MissionExecutionState:
    try:
        result = _manager(request).resume()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    request.app.state.anomaly_response_coordinator.dispatch_pending()  # anomalies queued while paused
    request.app.state.mission_drive_coordinator.advance()
    return result


@router.post("/current/stop", response_model=MissionExecutionState)
def stop_mission(request: Request) -> MissionExecutionState:
    try:
        result = _manager(request).stop()
    except NoCurrentMissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except InvalidExecutionTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    request.app.state.mission_drive_coordinator.abort()
    request.app.state.anomaly_response_coordinator.end_run("mission_stopped")
    request.app.state.mission_drive_coordinator.advance()  # drives the return-to-home leg (RETURNING_HOME)
    return result
