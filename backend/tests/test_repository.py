"""Write-once anomaly history. The Postgres tests run when TEST_DATABASE_URL is
set (CI provides a postgres service) and are skipped otherwise."""

import os
import time
from datetime import datetime, timezone

import psycopg
import pytest

from core.anomaly_repository import AnomalyRepository
from models.anomaly import Anomaly

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
needs_postgres = pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL not set")


def make_anomaly(anomaly_id: str, resolution=None) -> Anomaly:
    now = datetime.now(timezone.utc)
    return Anomaly(
        anomaly_id=anomaly_id,
        types=["lying_down", "loitering"],
        x=1.0,
        y=2.0,
        confidence=0.9,
        source_device_id="iot-01",
        detected_at=now,
        updated_at=now,
        last_seen_at=now,
        degrade_sec=30,
        expires_at=now,
        resolution=resolution,
        mission_id="m-1" if resolution else None,
    )


@pytest.fixture
def repository():
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS anomaly_history")
    repo = AnomalyRepository(DATABASE_URL)
    repo.init_schema()
    return repo


def rows():
    with psycopg.connect(DATABASE_URL) as conn:
        return conn.execute(
            "SELECT anomaly_id, types, resolution, mission_id FROM anomaly_history ORDER BY anomaly_id"
        ).fetchall()


@needs_postgres
def test_each_anomaly_is_written_exactly_once(repository: AnomalyRepository):
    closed_at = datetime.now(timezone.utc)
    repository.record_final(make_anomaly("a", "true_positive"), closed_at=closed_at)
    repository.record_final(make_anomaly("a", "false_positive"), closed_at=closed_at)  # ignored
    repository.record_final(make_anomaly("b", "unclear"), closed_at=closed_at)
    repository.record_final(make_anomaly("c"), closed_at=closed_at)  # expired, never visited
    assert rows() == [
        ("a", ["lying_down", "loitering"], "true_positive", "m-1"),
        ("b", ["lying_down", "loitering"], "unclear", "m-1"),
        ("c", ["lying_down", "loitering"], None, None),
    ]
    assert repository.is_connected()


def test_an_unreachable_database_never_blocks_for_long():
    # 192.0.2.0/24 is reserved for documentation: nothing answers there.
    repo = AnomalyRepository("postgresql://u:p@192.0.2.1:5432/db")
    started = time.monotonic()
    repo.record_final(make_anomaly("a"), closed_at=datetime.now(timezone.utc))
    assert time.monotonic() - started < 5  # gives up after the connect timeout

    started = time.monotonic()
    repo.record_final(make_anomaly("b"), closed_at=datetime.now(timezone.utc))
    assert not repo.is_connected()
    assert time.monotonic() - started < 0.5  # dropped straight away during the backoff
