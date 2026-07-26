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
