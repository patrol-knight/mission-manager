"""Heatmap weights, rendering, storage and recording. The service tests use the
real KS map and skip where lanelet2 isn't installed."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from core.heatmap.estimator import heat_at, render, weight
from core.heatmap.simulator import simulate
from core.heatmap.store import HeatmapStore
from models.anomaly import Anomaly
from models.heatmap import BaselineSpec, HeatEvent, HeatmapConfig, Hotspot, PreviewRequest, RealEvent

STORAGE = Path(__file__).resolve().parent.parent / "storage"
NOW = datetime.now(timezone.utc)


def event(verdict="true_positive", age_days=0.0, confidence=1.0, types=("loitering",), x=0.0, y=0.0) -> HeatEvent:
    return HeatEvent(x=x, y=y, age_days=age_days, verdict=verdict, types=list(types), confidence=confidence)


def real(id="a1", verdict="true_positive", closed_at=NOW) -> RealEvent:
    return RealEvent(id=id, x=1.0, y=2.0, closed_at=closed_at, verdict=verdict, types=["trespassing"], confidence=0.8)


def test_weight_combines_verdict_type_confidence_and_age():
    config = HeatmapConfig(half_life_days=7)
    assert weight(event(), config) == 1.0
    assert weight(event(verdict="expired", confidence=0.5), config) == pytest.approx(0.3 * 0.5)
    # A human verdict outranks the detector's confidence.
    assert weight(event(confidence=0.2), config) == 1.0
    assert weight(event(age_days=7), config) == pytest.approx(0.5)
    assert weight(event(age_days=7), HeatmapConfig(half_life_days=0)) == 1.0

    typed = HeatmapConfig(type_weights={"loitering": 0.5, "trespassing": 2.0, "lying_down": 1.0})
    assert weight(event(types=["loitering"]), typed) == 0.5
    assert weight(event(types=["loitering", "trespassing"]), typed) == 2.0


def test_render_uses_a_fixed_linear_scale():
    config = HeatmapConfig(full_at=4.0, half_life_days=0)
    one = render([event()], config)
    four = render([event()] * 4, config)
    assert one.values.max() == pytest.approx(0.25, abs=0.02)
    assert four.values.max() == pytest.approx(1.0, abs=0.02)
    assert render([], config) is None
    assert heat_at([event()] * 3, config, 0.0, 0.0) == pytest.approx(3.0)


def test_simulate_is_deterministic_and_within_the_window():
    spec = BaselineSpec(days=30, seed=3, hotspots=[Hotspot(name="gate", x=10, y=20, radius_m=3, per_day=5)])
    events = simulate(spec)
    assert events == simulate(spec)
    assert 100 < len(events) < 200
    assert all(0 <= e.age_days <= 30 for e in events)
    assert all((e.x - 10) ** 2 + (e.y - 20) ** 2 <= 9.01 for e in events)
    assert [e.age_days for e in events] == sorted((e.age_days for e in events), reverse=True)


def test_simulate_background_needs_lanes():
    spec = BaselineSpec(seed=1, background={"per_day": 3})
    assert simulate(spec) == []
    events = simulate(spec, [[(0.0, 0.0), (100.0, 0.0)]])
    assert events and all(-5 < e.x < 105 and abs(e.y) < 5 for e in events)


def test_store_round_trips_and_skips_bad_lines(tmp_path):
    store = HeatmapStore(tmp_path)
    assert store.config() == HeatmapConfig()
    assert store.spec() is None and store.baseline() == ({}, [])

    config = HeatmapConfig(full_at=6)
    store.save_config(config)
    assert store.config() == config

    spec = BaselineSpec(hotspots=[Hotspot(name="gate", x=1, y=2)])
    meta = store.save_baseline(spec, simulate(spec))
    assert store.spec() == spec
    assert store.baseline()[0] == meta and len(store.baseline()[1]) == meta["events"]

    assert store.append_real(real("a1"))
    assert not store.append_real(real("a1"))
    with (tmp_path / "real.jsonl").open("a") as f:
        f.write("not json\n")
    assert [e.id for e in store.real()] == ["a1"]
    assert store.clear_real() == 1
    assert store.real() == [] and store.append_real(real("a1"))


def test_real_events_age_from_their_close_time():
    assert real(closed_at=NOW - timedelta(days=2)).at(NOW).age_days == pytest.approx(2.0)


@pytest.fixture(scope="module")
def map_server():
    pytest.importorskip("lanelet2")
    from core.map_server import MapServer

    server = MapServer()
    server.load(str(STORAGE / "maps" / "ks" / "lanelet2_map.osm"), str(STORAGE / "maps" / "ks" / "map_projector_info.yaml"))
    return server


@pytest.fixture
def service(tmp_path, map_server):
    from core.heatmap import HeatmapService

    return HeatmapService(str(tmp_path), map_server)


def anomaly(resolution=None) -> Anomaly:
    return Anomaly(
        anomaly_id="a1", types=["loitering"], x=0.0, y=0.0, confidence=0.9, source_device_id="iot-01",
        detected_at=NOW, updated_at=NOW, last_seen_at=NOW, degrade_sec=10, expires_at=NOW, resolution=resolution,
    )


def test_service_records_anomalies_and_renders(service):
    assert service.get().available is False
    service.record_final(anomaly(), NOW)
    view = service.get()
    assert view.available and view.image.record_count == 1
    assert service.state().real_events == 1
    assert service._store.real()[0].verdict == "expired"


def test_cache_follows_new_events(service):
    service.record_final(anomaly(), NOW)
    first = service.get()
    assert service.get() is first
    service._store.append_real(real("a2"))
    assert service.get().image.record_count == 2


def test_baseline_save_merge_and_preview(service):
    spec = BaselineSpec(seed=2, hotspots=[Hotspot(name="gate", x=0, y=0, per_day=2)])
    state = service.save_baseline(spec)
    assert state.baseline.events > 0 and not state.baseline.stale
    n = state.baseline.events

    service.record_final(anomaly("true_positive"), NOW)
    preview = service.preview(PreviewRequest(config=HeatmapConfig(), view="all"))
    baseline_only = service.preview(PreviewRequest(config=HeatmapConfig(), view="baseline"))
    assert len(preview.points) == n + 1 and len(baseline_only.points) == n
    level = preview.hotspots[0]
    assert level.level_after_true == pytest.approx(level.level + 1 / HeatmapConfig().full_at)
    assert preview.hotspots[0].level > baseline_only.hotspots[0].level

    merged = service.merge_real()
    assert merged.baseline.events == n + 1 and merged.baseline.merged_real == 1 and merged.real_events == 0
    assert service.clear_real().real_events == 0


def test_preview_demo_events_are_not_saved(service):
    p = service._map_server.xy_to_latlon(0.0, 0.0)
    preview = service.preview(PreviewRequest(config=HeatmapConfig(), demo=[{"lon": p.lon, "lat": p.lat}]))
    assert [pt.source for pt in preview.points] == ["demo"]
    assert service.state().real_events == 0
