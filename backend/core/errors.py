class MissionNotFoundError(Exception):
    pass


class MissionAlreadyExistsError(Exception):
    pass


class MissionValidationError(Exception):
    pass


class MapUnavailableError(Exception):
    pass


class DeviceTypeMismatchError(Exception):
    pass


class NoCurrentMissionError(Exception):
    pass


class InvalidExecutionTransitionError(Exception):
    pass


class InsufficientWaypointsError(Exception):
    pass


class NoConnectedRobotError(Exception):
    pass


class MissionExecutionLockedError(Exception):
    pass


class AnomalyNotFoundError(Exception):
    pass


class InvalidAnomalyTransitionError(Exception):
    pass


class DeviceNotFoundError(Exception):
    pass


class DeviceNotConnectedError(Exception):
    pass


class CameraUnavailableError(Exception):
    pass


class CameraSessionError(Exception):
    """A camera session request that failed for a reason the client can act
    on. `code` is machine-readable (camera_busy, session_stopping, ...)."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class DeviceUnreachableError(Exception):
    pass


class InvestigationActiveError(Exception):
    pass


class NoActiveInvestigationError(Exception):
    pass


class VerdictRequiredError(Exception):
    pass


class NotOnSiteError(Exception):
    pass


class NoRouteError(Exception):
    pass
