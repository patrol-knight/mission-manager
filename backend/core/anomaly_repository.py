import logging
import threading
import time
from datetime import datetime

import psycopg

from models.anomaly import Anomaly

logger = logging.getLogger(__name__)

# A configured-but-unreachable Postgres must never stall the caller (e.g. the
# operator's Finish request): connects give up quickly, and after a failure
# the repository doesn't try again for a while -- writes in between are
# dropped.
CONNECT_TIMEOUT_SEC = 3
RETRY_AFTER_SEC = 30.0

# Write-once history: one row per anomaly, inserted at its terminal event
# (resolved, or expired) and never updated -- see record_final().
_SCHEMA = """
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
"""


class AnomalyRepository:
    """Durable history of anomalies from AnomalyRegistry
    (backend/core/anomaly_registry.py) -- one row per anomaly, written once
    when it closes: resolved by the operator (resolution set), or expired
    (resolution NULL). Live state -- refreshes, robot_en_route/robot_arrived
    -- stays purely in memory. This is the only place SQL is allowed to live
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

    init_schema()'s CREATE TABLE IF NOT EXISTS is a one-time bootstrap, not
    a migration system -- it will not alter an existing table's columns if
    this schema changes later. A real migration tool is a deliberate
    non-goal for now (see requirements.txt: no ORM/Alembic in this project).

    Single connection guarded by an RLock, not a pool -- same concurrency
    precedent as every other registry/coordinator in this codebase
    (threading.RLock protecting state shared between Zenoh's subscriber
    thread and FastAPI's thread-pool threads), and anomaly volume here
    doesn't warrant pool machinery.
    """

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
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

    def init_schema(self) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(_SCHEMA)
            except psycopg.Error:
                logger.error("AnomalyRepository: failed to initialize schema", exc_info=True)
                self._mark_down()

    def record_final(self, anomaly: Anomaly, closed_at: datetime) -> None:
        """Writes the anomaly's one and only history row. ON CONFLICT DO
        NOTHING makes a repeated call harmless; it also means an id that
        expired and was later re-created by a new refresh keeps its first
        row."""
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(
                    """
                    INSERT INTO anomaly_history (
                        anomaly_id, types, frame_id, x, y, lat, lon, confidence,
                        source_device_id, detected_at, last_seen_at, mission_id,
                        resolution, closed_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (anomaly_id) DO NOTHING
                    """,
                    (
                        anomaly.anomaly_id, list(anomaly.types), anomaly.frame_id, anomaly.x, anomaly.y,
                        anomaly.lat, anomaly.lon, anomaly.confidence,
                        anomaly.source_device_id, anomaly.detected_at, anomaly.last_seen_at,
                        anomaly.mission_id, anomaly.resolution, closed_at,
                    ),
                )
            except psycopg.Error as exc:
                # Expected when Postgres goes away mid-run: drop the row, no traceback.
                logger.warning("AnomalyRepository: Postgres write failed (%s); anomaly %s dropped", exc, anomaly.anomaly_id)
                self._mark_down()
