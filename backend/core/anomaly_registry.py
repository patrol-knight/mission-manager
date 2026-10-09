import threading
from datetime import datetime, timedelta, timezone

from core.anomaly_repository import AnomalyRepository
from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import Anomaly, AnomalyResolution, AnomalyStateMessage, AnomalyStatus

# A robot is physically committed to these -- expiry never removes them (the
# contract: "an anomaly under investigation by a robot is never removed by
# expiry").
_INVESTIGATING_STATUSES = (AnomalyStatus.ROBOT_EN_ROUTE, AnomalyStatus.ROBOT_ARRIVED)


class AnomalyRegistry:
    """In-memory, thread-safe store of anomalies — same shape/precedent as
    DeviceRegistry. Multiple independent writers (Zenoh ingest for
    create/refresh; the anomaly response coordinator for en_route/arrived;
    the verify/dismiss endpoints for the final transition; the monitor loop
    for expiry) share one instance.

    Lifetime follows ../anomaly_detection/docs/topics_format.md section 2.1:
    each state message extends `expires_at` (never shortens it), and once it
    passes, expire() removes the anomaly. There is no "end" message.

    When a repository is supplied, each anomaly is written to it exactly once,
    at its terminal event -- resolved (verify/dismiss) or expired -- and never
    updated afterwards (see core/anomaly_repository.py). The registry itself
    never issues SQL and never fails/blocks because of it; the repository is
    fail-soft on its own."""

    def __init__(self, repository: AnomalyRepository | None = None) -> None:
        self._lock = threading.RLock()
        self._anomalies: dict[str, Anomaly] = {}
        # Ids of resolved anomalies already removed from _anomalies. Feedback
        # delivery is best-effort, so Anomaly Detection may keep refreshing a
        # resolved id; without this, a late refresh after removal would
        # recreate it as a brand-new anomaly.
        self._resolved_ids: set[str] = set()
        self._repository = repository

    def ingest(
        self, message: AnomalyStateMessage, received_at: datetime, latlon: tuple[float, float] | None
    ) -> tuple[Anomaly, bool] | None:
        """Creates or refreshes an anomaly from one state message. Returns
        (stored anomaly, is_new), or None if the message was ignored because
        that anomaly is already resolved."""
        lat, lon = latlon if latlon is not None else (None, None)
        lifetime_end = received_at + timedelta(seconds=message.degrade_sec)
        with self._lock:
            if message.anomaly_id in self._resolved_ids:
                return None
            existing = self._anomalies.get(message.anomaly_id)
            if existing is not None and existing.resolution is not None:
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

    def update_status(self, anomaly_id: str, status: AnomalyStatus) -> Anomaly:
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            now = datetime.now(timezone.utc)
            update: dict = {"status": status, "updated_at": now}
            if status == AnomalyStatus.DETECTED and existing.status in _INVESTIGATING_STATUSES:
                # Back from an aborted investigation: expiry was suspended
                # meanwhile, so expires_at may already be in the past. A fresh
                # grace period keeps it from vanishing the moment the robot
                # leaves.
                update["expires_at"] = max(existing.expires_at, now + timedelta(seconds=existing.degrade_sec))
            updated = existing.model_copy(update=update)
            self._anomalies[anomaly_id] = updated
            return updated.model_copy(deep=True)

    def claim_for_investigation(self, anomaly_id: str) -> Anomaly | None:
        """Atomically DETECTED -> ROBOT_EN_ROUTE. Returns None if the anomaly
        is gone (expire() may remove it at any moment) or isn't DETECTED --
        a separate get() + update_status() would race with expiry."""
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None or existing.status != AnomalyStatus.DETECTED:
                return None
            updated = existing.model_copy(
                update={"status": AnomalyStatus.ROBOT_EN_ROUTE, "updated_at": datetime.now(timezone.utc)}
            )
            self._anomalies[anomaly_id] = updated
            return updated.model_copy(deep=True)

    def resolve(self, anomaly_id: str, resolution: AnomalyResolution) -> Anomaly:
        """The operator's verdict after inspecting the robot's camera feed
        (AnomalyVerifyModal.tsx): true_positive (confirmed real) or
        false_positive (confirmed false, not "skipped"). Both move the
        anomaly to VERIFIED.

        This is the anomaly's terminal event, so it's written to the
        repository here. It stays in memory (hidden from the map by its
        VERIFIED status) until expire() drops it, so late refreshes keep
        being ignored."""
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            if existing.status != AnomalyStatus.ROBOT_ARRIVED:
                raise InvalidAnomalyTransitionError(
                    f"Cannot resolve an anomaly with status {existing.status}"
                )
            resolved_at = datetime.now(timezone.utc)
            updated = existing.model_copy(
                update={
                    "status": AnomalyStatus.VERIFIED,
                    "updated_at": resolved_at,
                    "resolution": resolution,
                    "resolved_at": resolved_at,
                }
            )
            self._anomalies[anomaly_id] = updated
            stored = updated.model_copy(deep=True)
        if self._repository is not None:
            self._repository.record_final(stored, closed_at=resolved_at)
        return stored

    # Quoted: inside this class body, `list` is the method above, not the builtin.
    def expire(self, now: datetime | None = None) -> "list[str]":
        """Removes every anomaly whose expires_at has passed, except those a
        robot is investigating. Unresolved ones are written to the repository
        here (their terminal event); resolved ones were already written by
        resolve(). Returns the removed ids. Call periodically (app.py's
        monitor loop)."""
        now = datetime.now(timezone.utc) if now is None else now
        with self._lock:
            expired = [
                a
                for a in self._anomalies.values()
                if a.expires_at <= now and a.status not in _INVESTIGATING_STATUSES
            ]
            for anomaly in expired:
                del self._anomalies[anomaly.anomaly_id]
                if anomaly.resolution is not None:
                    self._resolved_ids.add(anomaly.anomaly_id)
        if self._repository is not None:
            for anomaly in expired:
                if anomaly.resolution is None:
                    self._repository.record_final(anomaly, closed_at=now)
        return [a.anomaly_id for a in expired]

    def record_mission_context(self, anomaly_id: str, mission_id: str) -> None:
        """Called by AnomalyResponseCoordinator at the moment a diversion
        actually starts -- records which mission the robot was executing when
        it diverted here, not merely whichever mission happened to be loaded
        at raw detection time. In memory only; it reaches the repository with
        the anomaly's final record. No-op if the anomaly is unknown, since
        this is best-effort context, not part of the anomaly's core
        lifecycle."""
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                return
            self._anomalies[anomaly_id] = existing.model_copy(update={"mission_id": mission_id})
