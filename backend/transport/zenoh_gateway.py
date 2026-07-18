import json
import logging
import time

from config import Settings
from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError
from core.websocket_manager import WebSocketManager
from models.device import DeviceState

logger = logging.getLogger(__name__)


class ZenohGateway:
    """Zenoh integration boundary.

    Real `zenoh` is imported lazily inside `start()` so this module — and
    `ingest_device_payload()` in particular — stays importable and testable
    when `eclipse-zenoh` is not installed or ZENOH_ENABLED=false.
    """

    def __init__(
        self,
        settings: Settings,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._settings = settings
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._session = None
        self._subscriber = None

    def start(self) -> None:
        if not self._settings.zenoh_enabled:
            logger.info("Zenoh disabled (ZENOH_ENABLED=false); gateway not started")
            return
        if self._session is not None:
            return  # already started; idempotent

        import zenoh  # isolated import: only required in enabled mode

        try:
            self._session = zenoh.open(zenoh.Config())
            self._subscriber = self._session.declare_subscriber(
                self._settings.zenoh_device_state_keyexpr,
                self._on_zenoh_sample,
            )
            logger.info(
                "Zenoh session opened on %s; subscribed to %s",
                self._settings.zenoh_router,
                self._settings.zenoh_device_state_keyexpr,
            )
        except Exception:
            self._session = None
            self._subscriber = None
            logger.error("Failed to start Zenoh gateway", exc_info=True)
            raise

    def stop(self) -> None:
        if self._subscriber is not None:
            self._subscriber.undeclare()
            self._subscriber = None
        if self._session is not None:
            self._session.close()
            self._session = None
        logger.info("Zenoh gateway stopped")

    def _on_zenoh_sample(self, sample) -> None:
        # Zenoh invokes this from its own thread, not the asyncio event loop.
        self.ingest_device_payload(bytes(sample.payload))

    def ingest_device_payload(
        self,
        payload: bytes | str | dict,
        received_at: float | None = None,
    ) -> bool:
        received_at = time.time() if received_at is None else received_at

        try:
            if isinstance(payload, (bytes, bytearray)):
                decoded = json.loads(payload.decode("utf-8"))
            elif isinstance(payload, str):
                decoded = json.loads(payload)
            elif isinstance(payload, dict):
                decoded = payload
            else:
                raise TypeError(f"Unsupported payload type: {type(payload)!r}")

            state = DeviceState(**decoded)
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
