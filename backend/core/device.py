from models.device import DeviceState, DeviceView

POSITION_EPSILON = 1e-3
YAW_EPSILON = 1e-3
SPEED_EPSILON = 1e-3
BATTERY_EPSILON = 1e-2


class BaseDevice:
    def __init__(self, state: DeviceState, last_seen: float) -> None:
        self.state = state
        self.last_seen = last_seen
        self.connected = True

    def to_view(self) -> DeviceView:
        return DeviceView(
            **self.state.model_dump(),
            connected=self.connected,
            last_seen=self.last_seen,
        )

    def apply(self, state: DeviceState, received_at: float) -> bool:
        reconnected = not self.connected
        changed = reconnected or self._meaningfully_differs(state)

        self.state = state
        self.last_seen = received_at
        self.connected = True
        return changed

    def mark_offline(self) -> bool:
        if not self.connected:
            return False
        self.connected = False
        return True

    def _meaningfully_differs(self, new: DeviceState) -> bool:
        old = self.state

        if old.name != new.name:
            return True
        if old.pose.frame_id != new.pose.frame_id:
            return True
        if abs(old.pose.x - new.pose.x) > POSITION_EPSILON:
            return True
        if abs(old.pose.y - new.pose.y) > POSITION_EPSILON:
            return True
        if abs(old.pose.yaw - new.pose.yaw) > YAW_EPSILON:
            return True
        if _optional_differs(old.battery, new.battery, BATTERY_EPSILON):
            return True
        if _optional_differs(old.speed, new.speed, SPEED_EPSILON):
            return True
        if old.status != new.status:
            return True
        if old.capabilities != new.capabilities:
            return True

        return False


def _optional_differs(old: float | None, new: float | None, epsilon: float) -> bool:
    if (old is None) != (new is None):
        return True
    if old is None or new is None:
        return False
    return abs(old - new) > epsilon
