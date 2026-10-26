import hashlib
import logging
import threading
import time
import uuid
from collections.abc import Sequence
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
    # Heartbeat, so a crashed run still has an end for its operating time.
    """
ALTER TABLE sessions ADD COLUMN last_seen_at TIMESTAMPTZ;
UPDATE sessions s SET last_seen_at = coalesce(
    s.ended_at, (SELECT max(h.closed_at) FROM anomaly_history h WHERE h.session_id = s.id), s.started_at
);
""",
    # Verification timing: response time and verified-before-expiry analysis.
    """
ALTER TABLE anomaly_history ADD COLUMN dispatched_at TIMESTAMPTZ, ADD COLUMN arrived_at TIMESTAMPTZ;
""",
    # Per-device operating time: one row per continuous stretch a device was connected.
    """
CREATE TABLE device_uptime (
    id           UUID PRIMARY KEY,
    session_id   UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    device_id    TEXT NOT NULL,
    device_type  TEXT NOT NULL,
    x            DOUBLE PRECISION,
    y            DOUBLE PRECISION,
    started_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX device_uptime_session_idx ON device_uptime (session_id);
""",
]

_UPSERT_SESSION = """
INSERT INTO sessions (id, map_name, map_hash, source, started_at, last_seen_at)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
"""


_INCLUDED_SESSIONS = "WHERE s.map_name = %s AND s.source = ANY(%s) AND NOT s.excluded"
_INCLUDED_HISTORY = f"FROM anomaly_history h JOIN sessions s ON s.id = h.session_id {_INCLUDED_SESSIONS}"


@dataclass(frozen=True)
class DeviceSample:
    """A device connected at heartbeat time."""

    device_id: str
    device_type: str
    x: float
    y: float


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
    (map, sim/real source), created at startup and kept alive by
    heartbeat(), so runs without anomalies still count as operating time. This is the only place SQL is allowed to live
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
        # device_id -> device_uptime row of its current connected stretch.
        self._open_uptime: dict[str, uuid.UUID] = {}
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
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                with conn.transaction():
                    conn.execute(_UPSERT_SESSION, self._session_row())
                    conn.execute(
                        """
                        INSERT INTO anomaly_history (
                            anomaly_id, types, frame_id, x, y, lat, lon, confidence,
                            source_device_id, detected_at, last_seen_at, mission_id,
                            resolution, closed_at, session_id, dispatched_at, arrived_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (anomaly_id) DO NOTHING
                        """,
                        (
                            anomaly.anomaly_id, list(anomaly.types), anomaly.frame_id, anomaly.x, anomaly.y,
                            anomaly.lat, anomaly.lon, anomaly.confidence,
                            anomaly.source_device_id, anomaly.detected_at, anomaly.last_seen_at,
                            anomaly.mission_id, anomaly.resolution, closed_at, self._session_id,
                            anomaly.dispatched_at, anomaly.arrived_at,
                        ),
                    )
            except psycopg.Error as exc:
                # Expected when Postgres goes away mid-run: drop the row, no traceback.
                logger.warning("AnomalyRepository: Postgres write failed (%s); anomaly %s dropped", exc, anomaly.anomaly_id)
                self._mark_down()

    def heartbeat(self, devices: Sequence[DeviceSample] = ()) -> None:
        """Creates this run's session, or marks it still running, and
        extends the uptime of every connected device. A device missing from
        `devices` ends its stretch at its last heartbeat."""
        now = datetime.now(timezone.utc)
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                with conn.transaction():
                    conn.execute(_UPSERT_SESSION, self._session_row())
                    open_uptime = {}
                    for device in devices:
                        row_id = self._open_uptime.get(device.device_id)
                        if row_id is not None:
                            updated = conn.execute(
                                "UPDATE device_uptime SET last_seen_at = %s WHERE id = %s", (now, row_id)
                            ).rowcount
                            if not updated:  # deleted with its session (devtools): start a new stretch
                                row_id = None
                        if row_id is None:
                            row_id = uuid.uuid4()
                            conn.execute(
                                "INSERT INTO device_uptime (id, session_id, device_id, device_type, x, y, "
                                "started_at, last_seen_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                                (row_id, self._session_id, device.device_id, device.device_type,
                                 device.x, device.y, now, now),
                            )
                        open_uptime[device.device_id] = row_id
                self._open_uptime = open_uptime
            except psycopg.Error as exc:
                logger.warning("AnomalyRepository: session heartbeat failed (%s)", exc)
                self._mark_down()

    def _session_row(self) -> tuple:
        context = self._context
        return (
            self._session_id, context.map_name, context.map_hash, context.source,
            self._started_at, datetime.now(timezone.utc),
        )

    # The reads below cover this map's included sessions of the given
    # sources -- usually just this run's source, but a demo can show sim
    # history and real alerts together.

    def history_stamp(self, sources: Sequence[str]) -> tuple | None:
        """Changes whenever the included history or sessions do, so callers
        can cache what they derive from history(). None while Postgres is
        unreachable."""
        rows = self._read(
            "SELECT count(DISTINCT s.id), count(h.anomaly_id), max(h.closed_at) "
            f"FROM sessions s LEFT JOIN anomaly_history h ON h.session_id = s.id {_INCLUDED_SESSIONS}",
            sources,
        )
        return None if rows is None else rows[0]

    def operating_periods(self, sources: Sequence[str]) -> list[tuple[datetime, datetime]] | None:
        """(start, end) of every included session. This run ends now; a
        crashed one at its last heartbeat."""
        rows = self._read(
            f"SELECT s.id, s.started_at, coalesce(s.ended_at, s.last_seen_at, s.started_at) FROM sessions s "
            f"{_INCLUDED_SESSIONS}",
            sources,
        )
        if rows is None:
            return None
        now = datetime.now(timezone.utc)
        return [(start, now if session_id == self._session_id else end) for session_id, start, end in rows]

    def history(self, sources: Sequence[str]) -> list[tuple] | None:
        """(x, y, confidence, closed_at, resolution, source_device_id) of
        every included anomaly."""
        return self._read(
            f"SELECT h.x, h.y, h.confidence, h.closed_at, h.resolution, h.source_device_id {_INCLUDED_HISTORY}",
            sources,
        )

    def device_operating_periods(self, sources: Sequence[str]) -> list[tuple[str, datetime, datetime]] | None:
        """(device_id, start, end) of every connected stretch in the included
        sessions. This run's open stretches end now."""
        rows = self._read(
            "SELECT u.id, u.device_id, u.started_at, u.last_seen_at "
            f"FROM device_uptime u JOIN sessions s ON s.id = u.session_id {_INCLUDED_SESSIONS}",
            sources,
        )
        if rows is None:
            return None
        now = datetime.now(timezone.utc)
        open_ids = set(self._open_uptime.values())
        return [(device, start, now if row_id in open_ids else end) for row_id, device, start, end in rows]

    def _read(self, query: str, sources: Sequence[str]) -> list[tuple] | None:
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return None
            try:
                return conn.execute(query, (self._context.map_name, list(sources))).fetchall()
            except psycopg.Error as exc:
                logger.warning("AnomalyRepository: history read failed (%s)", exc)
                self._mark_down()
                return None

    def close(self) -> None:
        """Marks this run's session ended."""
        with self._lock:
            conn = self._get_connection()
            if conn is None:
                return
            try:
                now = datetime.now(timezone.utc)
                conn.execute(
                    "UPDATE sessions SET ended_at = %s, last_seen_at = %s WHERE id = %s",
                    (now, now, self._session_id),
                )
                conn.close()
            except psycopg.Error as exc:
                logger.warning("AnomalyRepository: failed to end session (%s)", exc)
            self._conn = None
