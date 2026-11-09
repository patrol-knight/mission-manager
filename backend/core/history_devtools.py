import base64
import csv
import io
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import yaml

from config import Settings
from core.anomaly_repository import HISTORY_COLUMNS, AnomalyRepository, HistoryAdmin, file_hash
from core.errors import (
    HistoryUnavailableError,
    HistoryWriteDisabledError,
    ScenarioInvalidError,
    SessionNotFoundError,
)
from core.map_server import MapServer

try:
    from heatmap_estimator import (
        AnomalyRecord,
        Bounds,
        DemandConfig,
        DemandEstimator,
        DemandScale,
        HeatmapConfig,
        HeatmapEstimator,
        OperatingPeriod,
        VerdictWeights,
        verification_stats,
    )

    from core import history_synth

    ESTIMATOR_INSTALLED = True
except ImportError:
    ESTIMATOR_INSTALLED = False

Source = Literal["sim", "real"]
SourceFilter = Literal["sim", "real", "all"]


def _sources(source: SourceFilter) -> list[str]:
    return ["sim", "real"] if source == "all" else [source]


class HistoryDevtools:
    def __init__(
        self,
        settings: Settings,
        map_server: MapServer,
        repository: AnomalyRepository | None,
    ) -> None:
        self._settings = settings
        self._map = map_server
        self._repository = repository
        self._admin = HistoryAdmin(settings.database_url) if settings.database_url else None
        self._scenarios_dir = Path(settings.history_scenarios_dir)

    @property
    def write_enabled(self) -> bool:
        return self._settings.devtools_history_write

    def status(self) -> dict:
        s = self._settings
        database = {"configured": self._admin is not None}
        if self._admin is not None:
            database |= self._admin.status()
        return {
            "database": database,
            "map_name": self._map.get_info().map_name if self._map.is_available() else None,
            "estimator_installed": ESTIMATOR_INSTALLED,
            "write_enabled": self.write_enabled,
            "current_session_id": str(self._repository.session_id) if self._repository else None,
            "heatmap": {
                "sources": s.heatmap_source_list(),
                "bandwidth_m": s.heatmap_bandwidth_m,
                "half_life_days": s.heatmap_half_life_days,
                "prior_hours": s.heatmap_prior_hours,
                "floor_per_hour": s.heatmap_scale_floor,
                "ceiling_per_hour": s.heatmap_scale_ceiling,
            },
        }

    def _db(self) -> HistoryAdmin:
        if self._admin is None:
            raise HistoryUnavailableError("No database: DATABASE_URL is empty")
        return self._admin

    def _require_write(self) -> None:
        if not self.write_enabled:
            raise HistoryWriteDisabledError("Disabled: set DEVTOOLS_HISTORY_WRITE=true on the backend to allow it")

    def _require_estimator(self) -> None:
        if not ESTIMATOR_INSTALLED:
            raise HistoryUnavailableError("heatmap-estimator is not installed (modules/heatmap submodule)")

    def _map_name(self) -> str:
        return self._map.get_info().map_name

    def sessions(self) -> list[dict]:
        return self._db().sessions()

    def update_session(self, session_id: uuid.UUID, changes: dict) -> None:
        if not self._db().update_session(session_id, changes):
            raise SessionNotFoundError(f"Session {session_id} not found")

    def delete_session(self, session_id: uuid.UUID) -> None:
        self._require_write()
        if not self._db().delete_session(session_id):
            raise SessionNotFoundError(f"Session {session_id} not found")

    def purge(self, source: Source, older_than_days: float) -> dict:
        self._require_write()
        return self._db().purge(source, datetime.now(timezone.utc) - timedelta(days=older_than_days))

    def _lane_map(self) -> "history_synth.LaneMap":
        def to_latlon(x: float, y: float) -> tuple[float, float]:
            p = self._map.xy_to_latlon(x, y)
            return p.lat, p.lon

        return history_synth.LaneMap(
            self._map_name(), file_hash(self._settings.map_osm_path), self._map.centerlines_xy(), to_latlon
        )

    def _insert(self, generated: list) -> dict:
        db = self._db()
        for session, anomalies, uptime in generated:
            db.insert_session(session, anomalies, uptime)
        return {"sessions": len(generated), "anomalies": sum(len(a) for _, a, _ in generated)}

    def seed(self, **params) -> dict:
        self._require_write()
        self._require_estimator()
        self._db()
        return self._insert(history_synth.seed(self._lane_map(), **params))

    def scenarios(self) -> list[dict]:
        self._require_write()
        if not self._scenarios_dir.is_dir():
            return []
        return [{"file": p.name, "yaml": p.read_text()} for p in sorted(self._scenarios_dir.glob("*.yaml"))]

    def load_scenario(self, text: str) -> dict:
        self._require_write()
        self._require_estimator()
        self._db()
        try:
            scenario = history_synth.Scenario.from_yaml(text)
        except (ValueError, yaml.YAMLError) as exc:
            raise ScenarioInvalidError(f"Invalid scenario: {exc}") from exc
        return {"name": scenario.name, **self._insert(scenario.generate(self._lane_map()))}

    def export_csv(self, map_name: str | None, source: Source | None, session_id: uuid.UUID | None) -> str:
        rows = self._db().history(
            map_name=map_name, sources=[source] if source else None, session_id=session_id
        )
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(HISTORY_COLUMNS)
        for row in rows:
            writer.writerow(["|".join(row["types"]) if c == "types" else row[c] for c in HISTORY_COLUMNS])
        return buffer.getvalue()

    def _records(self, source: SourceFilter, include_excluded: bool) -> tuple[list[dict], list]:
        rows = self._db().history(self._map_name(), _sources(source), include_excluded)
        records = [
            AnomalyRecord(
                r["x"], r["y"], r["confidence"], r["closed_at"], r["resolution"],
                r["source_device_id"], r["detected_at"], r["dispatched_at"], r["arrived_at"],
            )
            for r in rows
        ]
        return rows, records

    def _device_periods(self, source: SourceFilter, include_excluded: bool) -> dict[str, list]:
        out: dict[str, list] = {}
        for device_id, start, end in self._db().device_periods(self._map_name(), _sources(source), include_excluded):
            out.setdefault(device_id, []).append(OperatingPeriod(start, end))
        return out

    def heatmap(
        self,
        model: Literal["demand", "density"],
        source: SourceFilter,
        include_excluded: bool,
        bandwidth_m: float,
        half_life_days: float,
        prior_hours: float,
        floor_per_hour: float,
        ceiling_per_hour: float,
        per_device: bool,
        use_confidence: bool,
        weights: tuple[float, float, float, float],
    ) -> dict:
        self._require_estimator()
        rows, records = self._records(source, include_excluded)
        now = datetime.now(timezone.utc)
        half_life = half_life_days or None
        bounds = Bounds(*self._map.get_xy_bounds())
        stats: dict = {"records": len(records)}

        started = time.perf_counter()
        if model == "demand":
            estimator = DemandEstimator(DemandConfig(
                bandwidth_m=bandwidth_m,
                half_life_days=half_life,
                prior_hours=prior_hours,
                scale=DemandScale(floor_per_hour, max(ceiling_per_hour, floor_per_hour * 1.01)),
            ))
            periods = [
                OperatingPeriod(a, b)
                for a, b in self._db().operating_periods(self._map_name(), _sources(source), include_excluded)
            ]
            device_periods = self._device_periods(source, include_excluded) if per_device else {}
            grid = estimator.estimate(records, periods, bounds=bounds, now=now, device_periods=device_periods)
            stats["operating_hours"] = round(estimator.operating_hours(periods, now), 2)
            stats["per_device_uptime"] = sorted(device_periods)
            if grid is not None:
                stats["peak_per_hour"] = round(float(grid.rate.max()), 3)
        else:
            estimator = HeatmapEstimator(HeatmapConfig(
                bandwidth_m=bandwidth_m,
                half_life_days=half_life,
                use_confidence=use_confidence,
                weights=VerdictWeights(*weights),
            ))
            grid = estimator.estimate(records, bounds=bounds, now=now)
        stats["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)

        counts = {"true_positive": 0, "unclear": 0, "expired": 0, "false_positive": 0}
        points = []
        for row, record in zip(rows, records, strict=True):
            verdict = row["resolution"] or "expired"
            counts[verdict] += 1
            lat, lon = row["lat"], row["lon"]
            if lat is None or lon is None:
                p = self._map.xy_to_latlon(row["x"], row["y"])
                lat, lon = p.lat, p.lon
            points.append({"lon": lon, "lat": lat, "verdict": verdict, "weight": estimator.weight(record, now)})
        stats["counts"] = counts
        return {"grid": self._encode_grid(grid) if grid is not None else None, "points": points, "stats": stats}

    def _encode_grid(self, grid) -> dict:
        b = grid.bounds
        corners = [(b.min_x, b.max_y), (b.max_x, b.max_y), (b.max_x, b.min_y), (b.min_x, b.min_y)]
        rows, cols = grid.values.shape
        return {
            "width": cols,
            "height": rows,
            "data": base64.b64encode(grid.to_uint8().tobytes()).decode("ascii"),
            "corners": [[(p := self._map.xy_to_latlon(x, y)).lon, p.lat] for x, y in corners],
        }

    def devices(self, source: SourceFilter, include_excluded: bool) -> dict:
        self._require_estimator()
        _, records = self._records(source, include_excluded)
        hours = {
            device: sum((p.ended_at - p.started_at).total_seconds() for p in periods) / 3600
            for device, periods in self._device_periods(source, include_excluded).items()
        }
        system_hours = sum(
            (b - a).total_seconds()
            for a, b in self._db().operating_periods(self._map_name(), _sources(source), include_excluded)
        ) / 3600
        return {
            "system_hours": round(system_hours, 2),
            "devices": [asdict(s) for s in verification_stats(records, device_hours=hours or None)],
        }
