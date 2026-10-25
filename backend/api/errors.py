from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from core.errors import (
    AlreadyOnSiteError,
    AnomalyNotFoundError,
    CameraSessionError,
    CameraUnavailableError,
    DeviceNotConnectedError,
    DeviceNotFoundError,
    DeviceUnreachableError,
    InsufficientWaypointsError,
    InvalidAnomalyTransitionError,
    InvalidExecutionTransitionError,
    InvestigationActiveError,
    MapUnavailableError,
    MissionAlreadyExistsError,
    MissionExecutionLockedError,
    MissionNotFoundError,
    MissionValidationError,
    NoActiveInvestigationError,
    NoConnectedRobotError,
    NoCurrentMissionError,
    NoRouteError,
    NotOnSiteError,
    VerdictRequiredError,
)

# The one place domain errors (core/errors.py) become HTTP status codes, so
# routers just call the service and let these propagate.
_STATUS_BY_ERROR: dict[type[Exception], int] = {
    MissionNotFoundError: 404,
    NoCurrentMissionError: 404,
    AnomalyNotFoundError: 404,
    DeviceNotFoundError: 404,
    MissionValidationError: 400,
    InsufficientWaypointsError: 400,
    CameraUnavailableError: 400,
    MissionAlreadyExistsError: 409,
    MissionExecutionLockedError: 409,
    InvalidExecutionTransitionError: 409,
    NoConnectedRobotError: 409,
    InvalidAnomalyTransitionError: 409,
    DeviceNotConnectedError: 409,
    InvestigationActiveError: 409,
    NoActiveInvestigationError: 409,
    VerdictRequiredError: 409,
    NotOnSiteError: 409,
    AlreadyOnSiteError: 409,
    NoRouteError: 409,
    MapUnavailableError: 503,
    DeviceUnreachableError: 503,
}


def register_error_handlers(app: FastAPI) -> None:
    async def camera_session_handler(_: Request, exc: Exception) -> JSONResponse:
        assert isinstance(exc, CameraSessionError)
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc), "code": exc.code})

    app.add_exception_handler(CameraSessionError, camera_session_handler)
    for error_type, status_code in _STATUS_BY_ERROR.items():

        async def handler(_: Request, exc: Exception, status_code: int = status_code) -> JSONResponse:
            return JSONResponse(status_code=status_code, content={"detail": str(exc)})

        app.add_exception_handler(error_type, handler)
