import base64
import logging
import threading
import time
from datetime import datetime, timezone

from core.anomaly_repository import AnomalyRepository
from core.map_server import MapServer
from models.map import HeatmapImage, HeatmapView

logger = logging.getLogger(__name__)

try:
    from heatmap_estimator import AnomalyRecord, Bounds, HeatmapEstimator
except ImportError:
    HeatmapEstimator = None

# The time decay drifts even without new history, so cached heatmaps age out.
CACHE_TTL_SEC = 300.0


class HeatmapService:
    """Anomaly-history heatmap for the mission editor. Optional twice over:
    needs the heatmap-estimator package and anomaly history (Postgres);
    without either it reports available=False and the map just has no
    heatmap. Cached until the history changes."""

    def __init__(self, repository: AnomalyRepository | None, map_server: MapServer) -> None:
        self._repository = repository
        self._map_server = map_server
        self._estimator = HeatmapEstimator() if HeatmapEstimator is not None else None
        self._lock = threading.Lock()
        self._cached: tuple[tuple, float, HeatmapView] | None = None

    @property
    def installed(self) -> bool:
        return self._estimator is not None

    def get(self) -> HeatmapView:
        if self._estimator is None or self._repository is None or not self._map_server.is_available():
            return HeatmapView(available=False)
        with self._lock:
            stamp = self._repository.history_stamp()
            if stamp is None:
                return HeatmapView(available=False)
            if self._cached and self._cached[0] == stamp and time.monotonic() - self._cached[1] < CACHE_TTL_SEC:
                return self._cached[2]
            rows = self._repository.history()
            if rows is None:
                return HeatmapView(available=False)
            view = HeatmapView(available=True, image=self._render(rows))
            self._cached = (stamp, time.monotonic(), view)
            return view

    def _render(self, rows: list[tuple]) -> HeatmapImage | None:
        records = [AnomalyRecord(x, y, confidence, closed_at, resolution) for x, y, confidence, closed_at, resolution in rows]
        grid = self._estimator.estimate(
            records, bounds=Bounds(*self._map_server.get_xy_bounds()), now=datetime.now(timezone.utc)
        )
        if grid is None:
            return None
        b = grid.bounds
        corners = [(b.min_x, b.max_y), (b.max_x, b.max_y), (b.max_x, b.min_y), (b.min_x, b.min_y)]
        rows_count, cols = grid.values.shape
        return HeatmapImage(
            width=cols,
            height=rows_count,
            data=base64.b64encode(grid.to_uint8().tobytes()).decode("ascii"),
            corners=[[(p := self._map_server.xy_to_latlon(x, y)).lon, p.lat] for x, y in corners],
            record_count=grid.record_count,
        )
