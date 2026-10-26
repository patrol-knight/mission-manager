import hashlib
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import psycopg

from models.anomaly import Anomaly

logger = logging.getLogger(__name__)

# A configured-but-unreachable Postgres must never stall the caller (e.g. the
# operator's Finish request): connects give up quickly, and after a failure
# the repository doesn't try again for a while -- writes in between are
# dropped.
CONNECT_TIMEOUT_SEC = 3
RETRY_AFTER_SEC = 30.0

# Applied in order, each once; schema_version holds how many have run.
# Append new migrations, never edit an applied one.
_MIGRATIONS = [
    """
CREATE TABLE IF NOT EXISTS anomaly_history (
    anomaly_id       TEXT PRIMARY KEY,
    types            TEXT[] NOT NULL,
    frame_id         TEXT NOT NULL,
    x                DOUBLE PRECISION NOT NULL,
    y                DOUBLE PRECISION NOT NULL,
    lat              DOUBLE PRECISION,
    lon              DOUBLE PRECISION,
    confidence       DOUBLE PRECISION NOT NULL,
    source_device_id TEXT NOT NULL,
    detected_at      TIMESTAMPTZ NOT NULL,
    last_seen_at     TIMESTAMPTZ NOT NULL,
    mission_id       TEXT,
    resolution       TEXT CHECK (resolution IN ('true_positive', 'false_positive', 'unclear')),
    closed_at        TIMESTAMPTZ NOT NULL
)
""",
    # Rows recorded before sessions existed go into one 'unknown' map session.
    """
CREATE TABLE sessions (
    id          UUID PRIMARY KEY,
    map_name    TEXT NOT NULL,
    map_hash    TEXT,
    source      TEXT NOT NULL CHECK (source IN ('sim', 'real')),
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ,
    excluded    BOOLEAN NOT NULL DEFAULT FALSE,
    label       TEXT
);
ALTER TABLE anomaly_history ADD COLUMN session_id UUID REFERENCES sessions (id) ON DELETE CASCADE;
INSERT INTO sessions (id, map_name, source, started_at, ended_at, label)
    SELECT gen_random_uuid(), 'unknown', 'sim', min(closed_at), max(closed_at), 'Recorded before sessions'
    FROM anomaly_history HAVING count(*) > 0;
UPDATE anomaly_history SET session_id = (SELECT id FROM sessions LIMIT 1);
ALTER TABLE anomaly_history ALTER COLUMN session_id SET NOT NULL;
CREATE INDEX anomaly_history_session_idx ON anomaly_history (session_id);
""",
]


_INCLUDED_HISTORY = """
FROM anomaly_history h JOIN sessions s ON s.id = h.session_id
WHERE s.map_name = %s AND s.source = %s AND NOT s.excluded
"""


@dataclass(frozen=True)
class RecordingContext:
    """What this backend run records under: one session row per run."""

    map_name: str
    source: str
    map_hash: str | None = None


def file_hash(path: str) -> str | None:
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:12]
    except OSError:
        return None


class AnomalyRepository:
    """Durable history of anomalies from AnomalyRegistry
    (backend/core/anomaly_registry.py) -- one row per anomaly, written once
    when it closes: resolved by the operator (resolution set), or expired
    (resolution NULL). Live state -- refreshes, robot_en_route/robot_arrived
    -- stays purely in memory. Every row belongs to this run's session
    (map, sim/real source), created with the run's first row. This is the only place SQL is allowed to live
    in this codebase -- callers go through this class's methods, never issue
    SQL themselves.

    Optional: only built when DATABASE_URL is set (bootstrap.py), and off by
    default. Fail-soft by design: every public method swallows psycopg errors
    (and connection failures), logs them, and returns without raising -- a
    Postgres outage must never break the in-memory anomaly workflow, only
    durable history. While Postgres is down, writes are dropped: there is
    deliberately no retry queue/backfill, and reconnecting is attempted at
    most every RETRY_AFTER_SEC with a CONNECT_TIMEOUT_SEC timeout, so a
    caller never waits long.

    init_schema() applies _MIGRATIONS that haven't run yet -- plain SQL, no
    ORM/Alembic in this project.

    Single connection guarded by an RLock, not a pool -- same concurrency
    precedent as every other registry/coordinator in this codebase
    (threading.RLock protecting state shared between Zenoh's subscriber
    thread and FastAPI's thread-pool threads), and anomaly volume here
    doesn't warrant pool machinery.
    """

    def __init__(self, dsn: str, context: RecordingContext) -> None:
        self._dsn = dsn
        self._context = context
        self._session_id = uuid.uuid4()
        self._started_at = datetime.now(timezone.utc)
        self._lock = threading.RLock()
        self._conn: psycopg.Connection | None = None
        self._degraded = False
        # time.monotonic() before which no reconnect is attempted.
        self._retry_at = 0.0

    def is_connected(self) -> bool:
        """Active liveness probe, not a cached-state read -- a connection
        object can report closed=False for a while after the other end
        actually dies (e.g. Postgres container stopped, TCP not yet reset),
        so trusting cached state here would let the status endpoint report
        connected=true when it isn't. This does a real round-trip, which is
        appropriate for something only hit on-demand via GET /api/system/status,
        not on every anomaly write."""
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return False
            try:
                conn.execute("SELECT 1")
            except psycopg.Error:
                logger.error("AnomalyRepository: liveness probe failed", exc_info=True)
                self._mark_down()
                return False
            return True

    def _get_connection(self) -> "psycopg.Connection | None":
        """Caller must hold self._lock. Returns None (already logged) if a
        connection can't be established right now."""
        if self._conn is not None and not self._conn.closed:
            return self._conn
        if time.monotonic() < self._retry_at:
            return None  # recently failed; drop this write rather than wait again
        try:
            self._conn = psycopg.connect(self._dsn, autocommit=True, connect_timeout=CONNECT_TIMEOUT_SEC)
        except psycopg.Error as exc:
            # Warning, not error, and no traceback -- an unreachable Postgres
            # is an expected, common state now (the "db" Compose profile is
            # opt-in, see docker-compose.yml), not necessarily a bug. Actual
            # write failures below (a connection that was live and then
            # broke mid-operation) stay at error level -- that's a more
            # genuine problem than "never configured/started".
            if not self._degraded:
                logger.warning(
                    "AnomalyRepository: Postgres unreachable (%s); anomaly history is dropped until it is back", exc
                )
            self._mark_down()
            return None
        if self._degraded:
            logger.info("AnomalyRepository: Postgres connection recovered")
        self._degraded = False
        return self._conn

    def _mark_down(self) -> None:
        """Caller must hold self._lock."""
        self._conn = None
        self._degraded = True
        self._retry_at = time.monotonic() + RETRY_AFTER_SEC

    @property
    def session_id(self) -> uuid.UUID:
        return self._session_id

    def init_schema(self) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
                (applied,) = conn.execute("SELECT coalesce(max(version), 0) FROM schema_version").fetchone()
                for version in range(applied + 1, len(_MIGRATIONS) + 1):
                    with conn.transaction():
                        conn.execute(_MIGRATIONS[version - 1])
                        conn.execute("INSERT INTO schema_version (version) VALUES (%s)", (version,))
                    logger.info("AnomalyRepository: applied schema migration %d", version)
            except psycopg.Error:
                logger.error("AnomalyRepository: failed to initialize schema", exc_info=True)
                self._mark_down()

    def record_final(self, anomaly: Anomaly, closed_at: datetime) -> None:
        """Writes the anomaly's one and only history row. ON CONFLICT DO
        NOTHING makes a repeated call harmless; it also means an id that
        expired and was later re-created by a new refresh keeps its first
        row. The session row is upserted alongside, so it also comes back if
        it was deleted while this run is still recording."""
        context = self._context
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                with conn.transaction():
                    conn.execute(
                        """
                        INSERT INTO sessions (id, map_name, map_hash, source, started_at)
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                        """,
                        (self._session_id, context.map_name, context.map_hash, context.source, self._started_at),
                    )
                    conn.execute(
                        """
                        INSERT INTO anomaly_history (
                            anomaly_id, types, frame_id, x, y, lat, lon, confidence,
                            source_device_id, detected_at, last_seen_at, mission_id,
                            resolution, closed_at, session_id
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (anomaly_id) DO NOTHING
                        """,
                        (
                            anomaly.anomaly_id, list(anomaly.types), anomaly.frame_id, anomaly.x, anomaly.y,
                            anomaly.lat, anomaly.lon, anomaly.confidence,
                            anomaly.source_device_id, anomaly.detected_at, anomaly.last_seen_at,
                            anomaly.mission_id, anomaly.resolution, closed_at, self._session_id,
                        ),
                    )
            except psycopg.Error as exc:
                # Expected when Postgres goes away mid-run: drop the row, no traceback.
                logger.warning("AnomalyRepository: Postgres write failed (%s); anomaly %s dropped", exc, anomaly.anomaly_id)
                self._mark_down()

    def history_stamp(self) -> tuple | None:
        """Changes whenever this map and source's included history does, so
        callers can cache what they derive from history(). None while
        Postgres is unreachable."""
        rows = self._read(f"SELECT count(*), max(h.closed_at) {_INCLUDED_HISTORY}")
        return None if rows is None else rows[0]

    def history(self) -> list[tuple] | None:
        """(x, y, confidence, closed_at, resolution) of every anomaly recorded
        on this map and source, minus excluded sessions."""
        return self._read(f"SELECT h.x, h.y, h.confidence, h.closed_at, h.resolution {_INCLUDED_HISTORY}")

    def _read(self, query: str) -> list[tuple] | None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return None
            try:
                return conn.execute(query, (self._context.map_name, self._context.source)).fetchall()
            except psycopg.Error as exc:
                logger.warning("AnomalyRepository: history read failed (%s)", exc)
                self._mark_down()
                return None

    def close(self) -> None:
        """Marks this run's session ended, if it recorded anything."""
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(
                    "UPDATE sessions SET ended_at = %s WHERE id = %s",
                    (datetime.now(timezone.utc), self._session_id),
                )
                conn.close()
            except psycopg.Error as exc:
                logger.warning("AnomalyRepository: failed to end session (%s)", exc)
            self._conn = None
