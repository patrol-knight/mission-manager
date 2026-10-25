import threading
from datetime import datetime, timedelta, timezone

from core.anomaly_repository import AnomalyRepository
from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import FINAL_VERDICTS, Anomaly, AnomalyStateMessage, AnomalyVerdict

# How long a removed closed anomaly's id is remembered, to ignore late refreshes.
CLOSED_ID_RETENTION = timedelta(hours=1)


class AnomalyRegistry:
    """In-memory, thread-safe store of live anomalies — same shape/precedent
    as DeviceRegistry. Writers: Zenoh ingest (create/refresh), the
    investigation coordinator (target/verdict), and the monitor loop (expiry).

    Lifetime follows ../anomaly_detection/docs/topics_format.md section 2.1:
    each state message extends `expires_at` (never shortens it), and once it
    passes, expire() removes the anomaly -- except the one the robot is
    investigating (set_target()). There is no "end" message.

    A final verdict (true/false positive) closes an anomaly: later refreshes
    are ignored and it leaves the map. An "unclear" verdict doesn't -- the
    anomaly stays live and can be investigated again.

    When a repository is supplied, each anomaly is written to it exactly once,
    at its terminal event -- a final verdict, or expiry -- and never updated
    (see core/anomaly_repository.py). The repository is fail-soft on its own."""

    def __init__(self, repository: AnomalyRepository | None = None) -> None:
        self._lock = threading.RLock()
        self._anomalies: dict[str, Anomaly] = {}
        # The anomaly the robot is investigating; expire() never removes it.
        self._target_id: str | None = None
        # Ids of closed anomalies already removed from _anomalies. Feedback
        # delivery is best-effort, so Anomaly Detection may keep refreshing a
        # closed id; without this, a late refresh after removal would
        # recreate it as a brand-new anomaly.
        self._closed_ids: dict[str, datetime] = {}
        self._repository = repository

    def ingest(
        self, message: AnomalyStateMessage, received_at: datetime, latlon: tuple[float, float] | None
    ) -> tuple[Anomaly, bool] | None:
        """Creates or refreshes an anomaly from one state message. Returns
        (stored anomaly, is_new), or None if the message was ignored because
        that anomaly is already closed."""
        lat, lon = latlon if latlon is not None else (None, None)
        lifetime_end = received_at + timedelta(seconds=message.degrade_sec)
        with self._lock:
            if message.anomaly_id in self._closed_ids:
                return None
            existing = self._anomalies.get(message.anomaly_id)
            if existing is not None and existing.is_closed:
                return None

            if existing is None:
                anomaly = Anomaly(
                    anomaly_id=message.anomaly_id,
                    types=list(message.types),
                    x=message.x,
                    y=message.y,
                    frame_id=message.frame_id,
                    confidence=message.confidence,
                    source_device_id=message.source_device_id,
                    detected_at=datetime.fromtimestamp(message.detected_at, timezone.utc),
                    updated_at=received_at,
                    last_seen_at=received_at,
                    degrade_sec=message.degrade_sec,
                    expires_at=lifetime_end,
                    lat=lat,
                    lon=lon,
                )
            else:
                # detected_at and source_device_id don't change on refresh
                # (contract), so the first message's values are kept.
                anomaly = existing.model_copy(
                    update={
                        "types": list(message.types),
                        "x": message.x,
                        "y": message.y,
                        "confidence": message.confidence,
                        "lat": lat,
                        "lon": lon,
                        "updated_at": received_at,
                        "last_seen_at": received_at,
                        "degrade_sec": message.degrade_sec,
                        "expires_at": max(existing.expires_at, lifetime_end),
                    }
                )
            self._anomalies[anomaly.anomaly_id] = anomaly
            return anomaly.model_copy(deep=True), existing is None

    def get(self, anomaly_id: str) -> Anomaly | None:
        with self._lock:
            anomaly = self._anomalies.get(anomaly_id)
            return anomaly.model_copy(deep=True) if anomaly else None

    def list(self) -> list[Anomaly]:
        with self._lock:
            return sorted(
                (a.model_copy(deep=True) for a in self._anomalies.values()),
                key=lambda a: a.detected_at,
                reverse=True,
            )

    def set_target(self, anomaly_id: str | None) -> Anomaly | None:
        """Atomically switches which anomaly expiry must leave alone (the one
        the robot is investigating). The previous target gets a fresh grace
        period, so it doesn't vanish the moment the robot turns away.

        Pass None to clear the target. For an id, returns the new target, or
        None -- leaving the previous target in place -- if it is gone (expiry
        may remove an untargeted anomaly at any moment) or already closed."""
        with self._lock:
            candidate = None
            if anomaly_id is not None:
                candidate = self._anomalies.get(anomaly_id)
                if candidate is None or candidate.is_closed:
                    return None
            previous = self._anomalies.get(self._target_id) if self._target_id else None
            if previous is not None and previous.anomaly_id != anomaly_id:
                fresh_end = datetime.now(timezone.utc) + timedelta(seconds=previous.degrade_sec)
                self._anomalies[previous.anomaly_id] = previous.model_copy(
                    update={"expires_at": max(previous.expires_at, fresh_end)}
                )
            self._target_id = anomaly_id
            return candidate.model_copy(deep=True) if candidate is not None else None

    def resolve(self, anomaly_id: str, verdict: AnomalyVerdict, mission_id: str | None) -> Anomaly:
        """Records the operator's verdict. A final verdict closes the anomaly
        and is its terminal event, so it's written to the repository here; it
        stays in memory, hidden from the map, until expire() drops it, so late
        refreshes keep being ignored. "unclear" is recorded but not final."""
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            if existing.is_closed:
                raise InvalidAnomalyTransitionError(f"Anomaly already resolved: {anomaly_id}")
            resolved_at = datetime.now(timezone.utc)
            updated = existing.model_copy(
                update={
                    "resolution": verdict,
                    "resolved_at": resolved_at,
                    "updated_at": resolved_at,
                    "mission_id": mission_id,
                }
            )
            self._anomalies[anomaly_id] = updated
            stored = updated.model_copy(deep=True)
        if self._repository is not None and verdict in FINAL_VERDICTS:
            self._repository.record_final(stored, closed_at=resolved_at)
        return stored

    # Quoted: inside this class body, `list` is the method above, not the builtin.
    def expire(self, now: datetime | None = None) -> "list[str]":
        """Removes every anomaly whose expires_at has passed, except the
        investigation target. Open ones (no verdict, or unclear) are written
        to the repository here, their terminal event; closed ones were
        already written by resolve(). Returns the removed ids. Call
        periodically (core/monitor.py)."""
        now = datetime.now(timezone.utc) if now is None else now
        with self._lock:
            expired = [
                a for a in self._anomalies.values() if a.expires_at <= now and a.anomaly_id != self._target_id
            ]
            for anomaly in expired:
                del self._anomalies[anomaly.anomaly_id]
                if anomaly.is_closed:
                    self._closed_ids[anomaly.anomaly_id] = now
            self._closed_ids = {
                anomaly_id: removed_at
                for anomaly_id, removed_at in self._closed_ids.items()
                if now - removed_at < CLOSED_ID_RETENTION
            }
        if self._repository is not None:
            for anomaly in expired:
                if not anomaly.is_closed:
                    self._repository.record_final(anomaly, closed_at=now)
        return [a.anomaly_id for a in expired]
