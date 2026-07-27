import threading
from datetime import datetime, timezone

from core.anomaly_repository import AnomalyRepository
from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import Anomaly, AnomalyStatus


class AnomalyRegistry:
    """In-memory, thread-safe store of anomalies — same shape/precedent as
    DeviceRegistry: the live state (anomalies are ephemeral field data) is
    never lost even if the optional durable-history write fails. When a
    repository is supplied, every mutation is also mirrored into Postgres
    for later analysis (see core/anomaly_repository.py) -- but the registry
    itself never issues SQL and never fails/blocks because of it; the
    repository is fail-soft on its own. Multiple independent writers (Zenoh
    ingest for create/en_route/arrived; the verify/dismiss endpoints for the
    final transition) share one instance."""

    def __init__(self, repository: AnomalyRepository | None = None) -> None:
        self._lock = threading.RLock()
        self._anomalies: dict[str, Anomaly] = {}
        self._repository = repository

    def create(self, anomaly: Anomaly) -> Anomaly:
        with self._lock:
            self._anomalies[anomaly.anomaly_id] = anomaly
            stored = anomaly.model_copy(deep=True)
        if self._repository is not None:
            self._repository.create(stored)
        return stored

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
            updated = existing.model_copy(update={"status": status, "updated_at": datetime.now(timezone.utc)})
            self._anomalies[anomaly_id] = updated
            return updated.model_copy(deep=True)

    def _resolve(self, anomaly_id: str, resolution: str) -> Anomaly:
        """Shared by verify() and dismiss() -- both end anomaly review via
        the same status transition (VERIFIED), but now record distinct
        resolutions: verify() -> true_positive, dismiss() -> false_positive.
        Both are only reachable from AnomalyVerifyModal.tsx after the
        operator has actually inspected the robot's camera feed (there is no
        "dismiss without inspecting" path in the frontend), so dismiss here
        genuinely means "confirmed false," not "skipped."""
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
                }
            )
            self._anomalies[anomaly_id] = updated
            stored = updated.model_copy(deep=True)
        if self._repository is not None:
            self._repository.update_resolution(anomaly_id, resolution, resolved_at)
        return stored

    def verify(self, anomaly_id: str) -> Anomaly:
        return self._resolve(anomaly_id, "true_positive")

    def dismiss(self, anomaly_id: str) -> Anomaly:
        return self._resolve(anomaly_id, "false_positive")

    def record_mission_context(self, anomaly_id: str, mission_id: str) -> None:
        """Called by AnomalyResponseCoordinator.on_anomaly_detected() at the
        moment a diversion actually starts -- records which mission the
        robot was executing when it diverted here, not merely whichever
        mission happened to be loaded at raw detection time. No-op if the
        anomaly is unknown (shouldn't happen -- caller only calls this right
        after creating it) rather than raising, since this is best-effort
        context, not part of the anomaly's core lifecycle."""
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                return
            updated = existing.model_copy(update={"mission_id": mission_id})
            self._anomalies[anomaly_id] = updated
        if self._repository is not None:
            self._repository.update_mission_context(anomaly_id, mission_id)
