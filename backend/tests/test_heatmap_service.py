"""The heatmap is optional: it needs heatmap-estimator and anomaly history.
The rendering tests skip where heatmap-estimator or lanelet2 isn't installed."""

from datetime import datetime, timezone
from pathlib import Path

import pytest

from core import heatmap_service
from core.heatmap_service import HeatmapService
from core.map_server import MapServer

STORAGE = Path(__file__).resolve().parent.parent / "storage"
NOW = datetime.now(timezone.utc)


class FakeRepository:
    def __init__(self, rows):
        self.rows = rows
        self.reads = 0

    def history_stamp(self):
        return (len(self.rows),)

    def history(self):
        self.reads += 1
        return list(self.rows)


@pytest.fixture(scope="module")
def map_server() -> MapServer:
    pytest.importorskip("lanelet2")
    server = MapServer()
    server.load(str(STORAGE / "maps" / "lanelet2_map.osm"), str(STORAGE / "maps" / "map_projector_info.yaml"))
    return server


def test_unavailable_without_history():
    assert HeatmapService(None, MapServer()).get().available is False


def test_unavailable_without_the_estimator(monkeypatch, map_server):
    monkeypatch.setattr(heatmap_service, "HeatmapEstimator", None)
    service = HeatmapService(FakeRepository([(0.0, 0.0, 0.9, NOW, None)]), map_server)
    assert service.installed is False
    assert service.get().available is False


def test_renders_and_caches_until_history_changes(map_server):
    pytest.importorskip("heatmap_estimator")
    repository = FakeRepository([(0.0, 0.0, 0.9, NOW, "true_positive")])
    service = HeatmapService(repository, map_server)

    view = service.get()
    assert view.available and view.image.record_count == 1
    assert len(view.image.data) > 0 and len(view.image.corners) == 4
    assert service.get() is view
    assert repository.reads == 1

    repository.rows.append((5.0, 5.0, 0.8, NOW, None))
    assert service.get().image.record_count == 2
    assert repository.reads == 2


def test_no_history_yet_is_available_without_an_image(map_server):
    pytest.importorskip("heatmap_estimator")
    view = HeatmapService(FakeRepository([]), map_server).get()
    assert view.available is True and view.image is None
