import logging
import threading
from datetime import datetime

import psycopg

from models.anomaly import Anomaly

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS anomalies (
    anomaly_id TEXT PRIMARY KEY,
    frame_id TEXT NOT NULL,
    x DOUBLE PRECISION NOT NULL,
    y DOUBLE PRECISION NOT NULL,
    lat DOUBLE PRECISION,
    lon DOUBLE PRECISION,
    type TEXT,
    confidence DOUBLE PRECISION,
    source_device_id TEXT,
    mission_id TEXT,
    detected_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolution TEXT CHECK (resolution IN ('true_positive', 'false_positive'))
)
"""


class AnomalyRepository:
    """Durable mirror of AnomalyRegistry (backend/core/anomaly_registry.py)
    for anomaly detections -- one row per anomaly (initial detection plus
    final resolution only; intermediate robot_en_route/robot_arrived status
    transitions are NOT persisted here, that's still purely in-memory/
    ephemeral). This is the only place SQL is allowed to live in this
    codebase -- callers (AnomalyRegistry, the Zenoh ingest path, API routes)
    go through this class's methods, never issue SQL themselves.

    Fail-soft by design: every public method swallows psycopg errors (and
    connection failures), logs them, and returns without raising -- a
    Postgres outage must never break the in-memory anomaly workflow
    (detect -> divert -> resolve), only durable history. There is
    deliberately no retry queue/backfill: an anomaly ingested while the
    database is unreachable is simply absent from durable history once the
    connection recovers.

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
                self._degraded = True
                self._conn = None
                return False
            return True

    def _get_connection(self) -> "psycopg.Connection | None":
        """Caller must hold self._lock. Returns None (already logged) if a
        connection can't be established right now."""
        if self._conn is not None and not self._conn.closed:
            return self._conn
        try:
            self._conn = psycopg.connect(self._dsn, autocommit=True)
        except psycopg.Error as exc:
            # Warning, not error, and no traceback -- an unreachable Postgres
            # is an expected, common state now (the "db" Compose profile is
            # opt-in, see docker-compose.yml), not necessarily a bug. Actual
            # write failures below (a connection that was live and then
            # broke mid-operation) stay at error level -- that's a more
            # genuine problem than "never configured/started".
            if not self._degraded:
                logger.warning("AnomalyRepository: Postgres unreachable (%s); anomaly history disabled", exc)
            self._conn = None
            self._degraded = True
            return None
        if self._degraded:
            logger.info("AnomalyRepository: Postgres connection recovered")
        self._degraded = False
        return self._conn

    def init_schema(self) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(_SCHEMA)
            except psycopg.Error:
                logger.error("AnomalyRepository: failed to initialize schema", exc_info=True)
                self._degraded = True
                self._conn = None

    def create(self, anomaly: Anomaly) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(
                    """
                    INSERT INTO anomalies (
                        anomaly_id, frame_id, x, y, lat, lon, type, confidence,
                        source_device_id, mission_id, detected_at, resolved_at, resolution
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (anomaly_id) DO NOTHING
                    """,
                    (
                        anomaly.anomaly_id, anomaly.frame_id, anomaly.x, anomaly.y,
                        anomaly.lat, anomaly.lon, anomaly.type, anomaly.confidence,
                        anomaly.source_device_id, anomaly.mission_id,
                        anomaly.detected_at, None, None,
                    ),
                )
            except psycopg.Error:
                logger.error(
                    "AnomalyRepository: failed to persist anomaly %s", anomaly.anomaly_id, exc_info=True
                )
                self._degraded = True
                self._conn = None

    def update_resolution(
        self, anomaly_id: str, resolution: str, resolved_at: datetime
    ) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(
                    "UPDATE anomalies SET resolution = %s, resolved_at = %s WHERE anomaly_id = %s",
                    (resolution, resolved_at, anomaly_id),
                )
            except psycopg.Error:
                logger.error(
                    "AnomalyRepository: failed to persist resolution for anomaly %s", anomaly_id, exc_info=True
                )
                self._degraded = True
                self._conn = None

    def update_mission_context(self, anomaly_id: str, mission_id: str) -> None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                conn.execute(
                    "UPDATE anomalies SET mission_id = %s WHERE anomaly_id = %s",
                    (mission_id, anomaly_id),
                )
            except psycopg.Error:
                logger.error(
                    "AnomalyRepository: failed to persist mission context for anomaly %s", anomaly_id, exc_info=True
                )
                self._degraded = True
                self._conn = None
