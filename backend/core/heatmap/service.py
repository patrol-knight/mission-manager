import base64
import logging
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from core.errors import MapUnavailableError
from core.heatmap.estimator import Bounds, HeatGrid, heat_at, render, weight
from core.heatmap.simulator import simulate
from core.heatmap.store import HeatmapStore, spec_hash
from core.map_server import MapServer
from models.anomaly import Anomaly
from models.heatmap import (
    HEAT_VERDICTS,
    BaselineInfo,
    BaselineSpec,
    HeatEvent,
    HeatmapConfig,
    HeatmapImage,
    HeatmapPreview,
    HeatmapState,
    HeatmapView,
    HotspotLevel,
    PreviewPoint,
    PreviewRequest,
    RealEvent,
)

logger = logging.getLogger(__name__)

# The time decay changes the heatmap even without new events.
CACHE_TTL_SEC = 300.0

Source = Literal["baseline", "real", "demo"]


class HeatmapService:
    """The mission editor's heatmap: the map's dummy baseline plus every real
    anomaly closed since, weighted by verdict, type, confidence and age.
    Also records those real anomalies (AnomalyRegistry calls record_final)
    and backs the /dev Heatmap tab."""

    def __init__(self, heatmap_dir: str, map_server: MapServer) -> None:
        self._map_server = map_server
        self._store = (
            HeatmapStore(Path(heatmap_dir) / map_server.get_info().map_name) if map_server.is_available() else None
        )
        self._lock = threading.Lock()
        self._cached: tuple[tuple, float, HeatmapView] | None = None

    def get(self) -> HeatmapView:
        if self._store is None:
            return HeatmapView(available=False)
        with self._lock:
            stamp = self._store.stamp()
            if self._cached and self._cached[0] == stamp and time.monotonic() - self._cached[1] < CACHE_TTL_SEC:
                return self._cached[2]
            events = [e for _, e in self._events("all")]
            image = self._image(render(events, self._store.config(), self._map_bounds()))
            view = HeatmapView(available=image is not None, image=image)
            self._cached = (stamp, time.monotonic(), view)
            return view

    def record_final(self, anomaly: Anomaly, closed_at: datetime) -> None:
        if self._store is None:
            return
        event = RealEvent(
            id=anomaly.anomaly_id,
            x=anomaly.x,
            y=anomaly.y,
            closed_at=closed_at,
            verdict=anomaly.resolution or "expired",
            types=anomaly.types,
            confidence=anomaly.confidence,
            device_id=anomaly.source_device_id,
        )
        try:
            self._store.append_real(event)
        except OSError:
            logger.warning("Failed to record anomaly %s for the heatmap", anomaly.anomaly_id, exc_info=True)

    def state(self) -> HeatmapState:
        store = self._require_store()
        meta, events = store.baseline()
        spec = store.spec()
        return HeatmapState(
            map_name=self._map_server.get_info().map_name,
            config=store.config(),
            defaults=HeatmapConfig(),
            spec=spec or BaselineSpec(),
            baseline=BaselineInfo(
                events=len(events),
                generated_at=meta.get("generated_at"),
                stale=spec is not None and meta.get("spec_hash") != spec_hash(spec),
                merged_real=meta.get("merged_real", 0),
            ),
            real_events=len(store.real()),
        )

    def preview(self, request: PreviewRequest) -> HeatmapPreview:
        started = time.perf_counter()
        config = request.config
        tagged = self._events(request.view, request.spec)
        for demo in request.demo:
            xy = self._map_server.latlon_to_xy(demo.lat, demo.lon)
            tagged.append(("demo", HeatEvent(
                x=xy.x, y=xy.y, age_days=0.0, verdict="true_positive", types=["trespassing"], confidence=1.0,
            )))
        events = [e for _, e in tagged]
        grid = render(events, config, self._map_bounds())
        spec = request.spec or self._require_store().spec() or BaselineSpec()
        hotspots = []
        for spot in spec.hotspots:
            heat = heat_at(events, config, spot.x, spot.y)
            bump = config.verdict_weights.true_positive * max(getattr(config.type_weights, t) for t in spot.types)
            p = self._map_server.xy_to_latlon(spot.x, spot.y)
            hotspots.append(HotspotLevel(
                name=spot.name, lon=p.lon, lat=p.lat,
                level=heat / config.full_at, level_after_true=(heat + bump) / config.full_at,
            ))
        points = []
        for source, e in tagged:
            p = self._map_server.xy_to_latlon(e.x, e.y)
            points.append(PreviewPoint(
                lon=p.lon, lat=p.lat, verdict=e.verdict, weight=weight(e, config), source=source,
            ))
        counts = Counter(e.verdict for e in events)
        return HeatmapPreview(
            image=self._image(grid),
            points=points,
            hotspots=hotspots,
            counts={v: counts[v] for v in HEAT_VERDICTS},
            peak_level=float(grid.heat.max() / config.full_at) if grid else 0.0,
            elapsed_ms=round((time.perf_counter() - started) * 1000, 1),
        )

    def save_config(self, config: HeatmapConfig) -> None:
        self._require_store().save_config(config)

    def save_baseline(self, spec: BaselineSpec) -> HeatmapState:
        self._require_store().save_baseline(spec, simulate(spec, self._lanes()))
        return self.state()

    def clear_real(self) -> HeatmapState:
        self._require_store().clear_real()
        return self.state()

    def merge_real(self) -> HeatmapState:
        """Moves real events into the baseline, ages relative to now, so they
        stay as part of the dummy history from here on."""
        store = self._require_store()
        meta, baseline = store.baseline()
        real = store.real()
        if real:
            now = datetime.now(timezone.utc)
            events = sorted(baseline + [r.at(now) for r in real], key=lambda e: -e.age_days)
            store.save_baseline(store.spec() or BaselineSpec(), events, meta.get("merged_real", 0) + len(real))
            store.clear_real()
        return self.state()

    def _events(self, view: str, spec: BaselineSpec | None = None) -> list[tuple[Source, HeatEvent]]:
        store = self._require_store()
        baseline = simulate(spec, self._lanes()) if spec is not None else store.baseline()[1]
        tagged: list[tuple[Source, HeatEvent]] = [("baseline", e) for e in baseline]
        if view == "all":
            now = datetime.now(timezone.utc)
            tagged += [("real", r.at(now)) for r in store.real()]
        return tagged

    def _require_store(self) -> HeatmapStore:
        if self._store is None:
            raise MapUnavailableError("Heatmap needs a loaded map")
        return self._store

    def _lanes(self) -> list[list[tuple[float, float]]]:
        return self._map_server.centerlines_xy()

    def _map_bounds(self) -> Bounds:
        return Bounds(*self._map_server.get_xy_bounds())

    def _image(self, grid: HeatGrid | None) -> HeatmapImage | None:
        if grid is None:
            return None
        b = grid.bounds
        corners = [(b.min_x, b.max_y), (b.max_x, b.max_y), (b.max_x, b.min_y), (b.min_x, b.min_y)]
        rows, cols = grid.values.shape
        return HeatmapImage(
            width=cols,
            height=rows,
            data=base64.b64encode(grid.to_uint8().tobytes()).decode("ascii"),
            corners=[[(p := self._map_server.xy_to_latlon(x, y)).lon, p.lat] for x, y in corners],
            record_count=grid.record_count,
        )
