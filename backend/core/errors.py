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
