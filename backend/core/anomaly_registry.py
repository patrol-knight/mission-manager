import threading
from datetime import datetime, timezone

from core.errors import AnomalyNotFoundError, InvalidAnomalyTransitionError
from models.anomaly import Anomaly, AnomalyStatus


class AnomalyRegistry:
    """In-memory, thread-safe store of anomalies — same shape/precedent as
    DeviceRegistry: no persistence (anomalies are ephemeral field data), and
    multiple independent writers (the dev simulator for create/en_route/
    arrived; the verify endpoint for the final transition) share one instance."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._anomalies: dict[str, Anomaly] = {}

    def create(self, anomaly: Anomaly) -> Anomaly:
        with self._lock:
            self._anomalies[anomaly.anomaly_id] = anomaly
            return anomaly.model_copy(deep=True)

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

    def verify(self, anomaly_id: str) -> Anomaly:
        with self._lock:
            existing = self._anomalies.get(anomaly_id)
            if existing is None:
                raise AnomalyNotFoundError(f"Anomaly not found: {anomaly_id}")
            if existing.status != AnomalyStatus.ROBOT_ARRIVED:
                raise InvalidAnomalyTransitionError(
                    f"Cannot verify an anomaly with status {existing.status}"
                )
            return self.update_status(anomaly_id, AnomalyStatus.VERIFIED)
