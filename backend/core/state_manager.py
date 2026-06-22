import threading


class StateManager:
    def __init__(self):
        self._lock  = threading.Lock()
        self._state = None
        self._ready = False

    def update(
        self,
        x: float,
        y: float,
        yaw: float,
        speed: float = 0.0,
        lat: float | None = None,
        lon: float | None = None,
    ):
        with self._lock:
            self._state = {
                'x':     x,
                'y':     y,
                'yaw':   yaw,
                'speed': speed,
                'lat':   lat,  
                'lon':   lon,
            }
            self._ready = True

    def get(self):
        with self._lock:
            return dict(self._state) if self._ready else None
