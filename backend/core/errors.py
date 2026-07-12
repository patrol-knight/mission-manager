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
