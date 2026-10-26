import base64
import logging
import threading
import time
from datetime import datetime, timezone

from config import Settings
from core.anomaly_repository import AnomalyRepository
from core.map_server import MapServer
from models.map import HeatmapImage, HeatmapView

logger = logging.getLogger(__name__)

try:
    from heatmap_estimator import AnomalyRecord, Bounds, DemandConfig, DemandEstimator, DemandScale, OperatingPeriod
except ImportError:
    DemandEstimator = None

# Time decay and this run's growing operating time change the result even
# without new history, so cached heatmaps age out.
CACHE_TTL_SEC = 300.0


class HeatmapService:
    """Alert-demand heatmap for the mission editor: alerts per operating
    hour around each spot, on a fixed scale (heatmap-estimator's
    DemandEstimator). Optional twice over: needs the heatmap-estimator
    package and anomaly history (Postgres); without either it reports
    available=False and the map just has no heatmap. Cached until the
    history changes."""

    def __init__(
        self,
        repository: AnomalyRepository | None,
        map_server: MapServer,
        settings: Settings | None = None,
    ) -> None:
        settings = settings or Settings(_env_file=None)
        self._repository = repository
        self._map_server = map_server
        self._sources = settings.heatmap_source_list()
        self._estimator = None
        if DemandEstimator is not None:
            self._estimator = DemandEstimator(DemandConfig(
                bandwidth_m=settings.heatmap_bandwidth_m,
                half_life_days=settings.heatmap_half_life_days or None,
                prior_hours=settings.heatmap_prior_hours,
                scale=DemandScale(settings.heatmap_scale_floor, settings.heatmap_scale_ceiling),
            ))
        self._lock = threading.Lock()
        self._cached: tuple[tuple, float, HeatmapView] | None = None

    @property
    def installed(self) -> bool:
        return self._estimator is not None

    def get(self) -> HeatmapView:
        if self._estimator is None or self._repository is None or not self._map_server.is_available():
            return HeatmapView(available=False)
        with self._lock:
            stamp = self._repository.history_stamp(self._sources)
            if stamp is None:
                return HeatmapView(available=False)
            if self._cached and self._cached[0] == stamp and time.monotonic() - self._cached[1] < CACHE_TTL_SEC:
                return self._cached[2]
            rows = self._repository.history(self._sources)
            periods = self._repository.operating_periods(self._sources)
            device_periods = self._repository.device_operating_periods(self._sources)
            if rows is None or periods is None or device_periods is None:
                return HeatmapView(available=False)
            view = HeatmapView(available=True, image=self._render(rows, periods, device_periods))
            self._cached = (stamp, time.monotonic(), view)
            return view

    def _render(self, rows: list[tuple], periods: list[tuple], device_periods: list[tuple]) -> HeatmapImage | None:
        records = [
            AnomalyRecord(x, y, confidence, closed_at, resolution, device_id)
            for x, y, confidence, closed_at, resolution, device_id in rows
        ]
        by_device: dict[str, list[OperatingPeriod]] = {}
        for device_id, start, end in device_periods:
            by_device.setdefault(device_id, []).append(OperatingPeriod(start, end))
        grid = self._estimator.estimate(
            records,
            [OperatingPeriod(start, end) for start, end in periods],
            bounds=Bounds(*self._map_server.get_xy_bounds()),
            now=datetime.now(timezone.utc),
            device_periods=by_device,
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
