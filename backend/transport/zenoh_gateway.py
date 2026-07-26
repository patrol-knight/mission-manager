import json
import logging
import time

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError
from core.websocket_manager import WebSocketManager
from models.anomaly import Anomaly
from models.device import DeviceState

logger = logging.getLogger(__name__)


class ZenohGateway:
    """Zenoh integration boundary.

    Real `zenoh` is imported lazily inside `start()` so this module — and
    `ingest_device_payload()`/`ingest_anomaly_payload()` in particular — stays
    importable and testable when `eclipse-zenoh` is not installed or
    ZENOH_ENABLED=false.
    """

    def __init__(
        self,
        settings: Settings,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
        anomaly_registry: AnomalyRegistry,
    ) -> None:
        self._settings = settings
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._anomaly_registry = anomaly_registry
        self._session = None
        self._device_subscriber = None
        self._anomaly_subscriber = None

    def start(self) -> None:
        if not self._settings.zenoh_enabled:
            logger.info("Zenoh disabled (ZENOH_ENABLED=false); gateway not started")
            return
        if self._session is not None:
            return  # already started; idempotent

        import zenoh  # isolated import: only required in enabled mode

        try:
            self._session = zenoh.open(zenoh.Config())
            self._device_subscriber = self._session.declare_subscriber(
                self._settings.zenoh_device_state_keyexpr,
                self._on_zenoh_device_sample,
            )
            self._anomaly_subscriber = self._session.declare_subscriber(
                self._settings.zenoh_anomaly_keyexpr,
                self._on_zenoh_anomaly_sample,
            )
            logger.info(
                "Zenoh session opened on %s; subscribed to %s and %s",
                self._settings.zenoh_router,
                self._settings.zenoh_device_state_keyexpr,
                self._settings.zenoh_anomaly_keyexpr,
            )
        except Exception:
            self._session = None
            self._device_subscriber = None
            self._anomaly_subscriber = None
            logger.error("Failed to start Zenoh gateway", exc_info=True)
            raise

    def stop(self) -> None:
        if self._device_subscriber is not None:
            self._device_subscriber.undeclare()
            self._device_subscriber = None
        if self._anomaly_subscriber is not None:
            self._anomaly_subscriber.undeclare()
            self._anomaly_subscriber = None
        if self._session is not None:
            self._session.close()
            self._session = None
        logger.info("Zenoh gateway stopped")

    def _on_zenoh_device_sample(self, sample) -> None:
        # Zenoh invokes this from its own thread, not the asyncio event loop.
        self.ingest_device_payload(bytes(sample.payload))

    def _on_zenoh_anomaly_sample(self, sample) -> None:
        self.ingest_anomaly_payload(bytes(sample.payload))

    @staticmethod
    def _decode_json_payload(payload: bytes | str | dict) -> dict:
        if isinstance(payload, (bytes, bytearray)):
            return json.loads(payload.decode("utf-8"))
        if isinstance(payload, str):
            return json.loads(payload)
        if isinstance(payload, dict):
            return payload
        raise TypeError(f"Unsupported payload type: {type(payload)!r}")

    def ingest_device_payload(
        self,
        payload: bytes | str | dict,
        received_at: float | None = None,
    ) -> bool:
        received_at = time.time() if received_at is None else received_at

        try:
            state = DeviceState(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed device payload: %s", exc)
            return False

        try:
            changed = self._device_registry.upsert(state, received_at=received_at)
        except DeviceTypeMismatchError as exc:
            logger.warning("Discarding device payload: %s", exc)
            return False

        if changed:
            view = self._device_registry.get(state.device_id)
            self._websocket_manager.broadcast_threadsafe(
                {
                    "type": "device.updated",
                    "data": view.model_dump(mode="json") if view else None,
                }
            )
        return changed

    def ingest_anomaly_payload(self, payload: bytes | str | dict) -> bool:
        """Real-device counterpart to the dev simulator's `_tick_anomaly` —
        lets a real anomaly-detection pipeline publish anomalies the same way
        real devices publish state, via the same DeviceRegistry-style
        upsert + conditional broadcast pattern. Expects the same JSON shape
        as `Anomaly.model_dump(mode="json")` (see models/anomaly.py)."""
        try:
            anomaly = Anomaly(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed anomaly payload: %s", exc)
            return False

        is_new = self._anomaly_registry.get(anomaly.anomaly_id) is None
        stored = self._anomaly_registry.create(anomaly)  # create() is upsert-semantics — no existence check

        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "anomaly.created" if is_new else "anomaly.updated",
                "data": stored.model_dump(mode="json"),
            }
        )
        return True
