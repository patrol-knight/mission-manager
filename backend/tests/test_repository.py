"""Write-once anomaly history. The Postgres tests run when TEST_DATABASE_URL is
set (CI provides a postgres service) and are skipped otherwise."""

import os
import time
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from core.anomaly_repository import AnomalyRepository, DeviceSample, RecordingContext
from models.anomaly import Anomaly

DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
needs_postgres = pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL not set")
CONTEXT = RecordingContext(map_name="campus", source="sim", map_hash="abc123")


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


def drop_all():
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("DROP TABLE IF EXISTS device_uptime, anomaly_history, sessions, schema_version")


@pytest.fixture
def repository():
    drop_all()
    repo = AnomalyRepository(DATABASE_URL, CONTEXT)
    repo.init_schema()
    return repo


def sessions():
    with psycopg.connect(DATABASE_URL) as conn:
        return conn.execute(
            "SELECT id, map_name, map_hash, source, ended_at IS NOT NULL, label FROM sessions ORDER BY started_at"
        ).fetchall()


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


@needs_postgres
def test_a_run_records_into_one_session_created_with_its_first_row(repository: AnomalyRepository):
    assert sessions() == []
    repository.record_final(make_anomaly("a"), closed_at=datetime.now(timezone.utc))
    repository.record_final(make_anomaly("b"), closed_at=datetime.now(timezone.utc))
    assert sessions() == [(repository.session_id, "campus", "abc123", "sim", False, None)]

    repository.close()
    assert sessions()[0][4] is True


@needs_postgres
def test_a_run_without_anomalies_is_still_a_session(repository: AnomalyRepository):
    repository.heartbeat()
    assert [(s[0], s[4]) for s in sessions()] == [(repository.session_id, False)]
    assert rows() == []

    (start, end), = repository.operating_periods(["sim"])
    assert start <= end <= datetime.now(timezone.utc)


@needs_postgres
def test_operating_periods_end_at_the_last_heartbeat_unless_ended(repository: AnomalyRepository):
    crashed = AnomalyRepository(DATABASE_URL, CONTEXT)
    crashed.heartbeat()
    ended = AnomalyRepository(DATABASE_URL, CONTEXT)
    ended.heartbeat()
    ended.close()
    other_map = AnomalyRepository(DATABASE_URL, RecordingContext(map_name="elsewhere", source="sim"))
    other_map.heartbeat()

    periods = repository.operating_periods(["sim"])
    assert len(periods) == 2
    assert all(start <= end for start, end in periods)


@needs_postgres
def test_verification_times_are_recorded(repository: AnomalyRepository):
    anomaly = make_anomaly("a", "true_positive")
    dispatched = datetime.now(timezone.utc)
    anomaly = anomaly.model_copy(update={"dispatched_at": dispatched, "arrived_at": dispatched + timedelta(seconds=40)})
    repository.record_final(anomaly, closed_at=datetime.now(timezone.utc))
    with psycopg.connect(DATABASE_URL) as conn:
        row = conn.execute("SELECT arrived_at - dispatched_at FROM anomaly_history").fetchone()
    assert row[0] == timedelta(seconds=40)


@needs_postgres
def test_device_uptime_follows_heartbeats(repository: AnomalyRepository):
    tower = DeviceSample("iot-01", "iot", 0.0, 0.0)
    robot = DeviceSample("robot-1", "robot", 5.0, 5.0)
    repository.heartbeat([tower, robot])
    repository.heartbeat([tower])
    repository.heartbeat([tower, robot])

    periods = repository.device_operating_periods(["sim"])
    assert sorted(d for d, _, _ in periods) == ["iot-01", "robot-1", "robot-1"]
    assert all(start <= end for _, start, end in periods)


@needs_postgres
def test_device_uptime_survives_its_session_being_deleted(repository: AnomalyRepository):
    tower = DeviceSample("iot-01", "iot", 0.0, 0.0)
    repository.heartbeat([tower])
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("DELETE FROM sessions")
    repository.heartbeat([tower])
    assert [d for d, _, _ in repository.device_operating_periods(["sim"])] == ["iot-01"]


@needs_postgres
def test_reads_can_mix_sources(repository: AnomalyRepository):
    real = AnomalyRepository(DATABASE_URL, RecordingContext(map_name="campus", source="real"))
    repository.record_final(make_anomaly("sim-1"), closed_at=datetime.now(timezone.utc))
    real.record_final(make_anomaly("real-1"), closed_at=datetime.now(timezone.utc))

    assert len(repository.history(["sim"])) == 1
    assert len(repository.history(["real"])) == 1
    assert len(repository.history(["sim", "real"])) == 2
    assert len(repository.operating_periods(["sim", "real"])) == 2


@needs_postgres
def test_a_deleted_session_comes_back_with_the_next_row(repository: AnomalyRepository):
    repository.record_final(make_anomaly("a"), closed_at=datetime.now(timezone.utc))
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute("DELETE FROM sessions")
    assert rows() == []

    repository.record_final(make_anomaly("b"), closed_at=datetime.now(timezone.utc))
    assert [r[0] for r in rows()] == ["b"]
    assert len(sessions()) == 1


@needs_postgres
def test_rows_from_before_sessions_are_migrated_into_an_unknown_session():
    drop_all()
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        conn.execute(_V1_TABLE)
        conn.execute(
            "INSERT INTO anomaly_history VALUES ('old', '{loitering}', 'map', 0, 0, NULL, NULL, 0.8, 'iot-01', "
            "now(), now(), NULL, NULL, now())"
        )
    repo = AnomalyRepository(DATABASE_URL, CONTEXT)
    repo.init_schema()
    repo.init_schema()
    repo.record_final(make_anomaly("new"), closed_at=datetime.now(timezone.utc))

    assert [(s[1], s[3], s[5]) for s in sessions()] == [
        ("unknown", "sim", "Recorded before sessions"),
        ("campus", "sim", None),
    ]
    assert [r[0] for r in rows()] == ["new", "old"]


_V1_TABLE = """
CREATE TABLE anomaly_history (
    anomaly_id TEXT PRIMARY KEY, types TEXT[] NOT NULL, frame_id TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL, y DOUBLE PRECISION NOT NULL, lat DOUBLE PRECISION, lon DOUBLE PRECISION,
    confidence DOUBLE PRECISION NOT NULL, source_device_id TEXT NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL, mission_id TEXT,
    resolution TEXT, closed_at TIMESTAMPTZ NOT NULL
)
"""


def test_an_unreachable_database_never_blocks_for_long():
    # 192.0.2.0/24 is reserved for documentation: nothing answers there.
    repo = AnomalyRepository("postgresql://u:p@192.0.2.1:5432/db", CONTEXT)
    started = time.monotonic()
    repo.record_final(make_anomaly("a"), closed_at=datetime.now(timezone.utc))
    assert time.monotonic() - started < 5  # gives up after the connect timeout

    started = time.monotonic()
    repo.record_final(make_anomaly("b"), closed_at=datetime.now(timezone.utc))
    assert not repo.is_connected()
    assert time.monotonic() - started < 0.5  # dropped straight away during the backoff
