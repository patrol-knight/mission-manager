import json
import logging
import time
from typing import TYPE_CHECKING

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError, MapUnavailableError
from core.map_server import MapServer
from core.websocket_manager import WebSocketManager
from models.anomaly import Anomaly
from models.device import DeviceState

if TYPE_CHECKING:
    from core.anomaly_response import AnomalyResponseCoordinator
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)


class ZenohGateway:
    """Zenoh integration boundary.

    Real `zenoh` is imported lazily inside `start()` so this module — and
    `ingest_device_payload()`/`ingest_anomaly_payload()` in particular — stays
    importable and testable when `eclipse-zenoh` is not installed or
    ZENOH_ENABLED=false.

    `anomaly_response_coordinator`/`mission_drive_coordinator` are bound
    after construction via `bind_coordinators()`, not passed into
    __init__ — both of them need a `ZenohGateway` to send commands through
    (see `publish_command`), so this side of the dependency has to be
    late-bound to avoid a construction cycle (see bootstrap.py).
    """

    def __init__(
        self,
        settings: Settings,
        device_registry: DeviceRegistry,
        websocket_manager: WebSocketManager,
        anomaly_registry: AnomalyRegistry,
        map_server: MapServer,
    ) -> None:
        self._settings = settings
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._anomaly_registry = anomaly_registry
        self._map_server = map_server
        self._anomaly_response_coordinator: "AnomalyResponseCoordinator | None" = None
        self._mission_drive_coordinator: "MissionDriveCoordinator | None" = None
        self._session = None
        self._device_subscriber = None
        self._anomaly_subscriber = None

    def bind_coordinators(
        self,
        anomaly_response_coordinator: "AnomalyResponseCoordinator",
        mission_drive_coordinator: "MissionDriveCoordinator",
    ) -> None:
        self._anomaly_response_coordinator = anomaly_response_coordinator
        self._mission_drive_coordinator = mission_drive_coordinator

    def start(self) -> None:
        if not self._settings.zenoh_enabled:
            logger.info("Zenoh disabled (ZENOH_ENABLED=false); gateway not started")
            return
        if self._session is not None:
            return  # already started; idempotent

        import zenoh  # isolated import: only required in enabled mode

        try:
            config = zenoh.Config()
            config.insert_json5("mode", json.dumps("client"))
            config.insert_json5("connect/endpoints", json.dumps([self._settings.zenoh_router]))
            self._session = zenoh.open(config)
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

    def _project_latlon(self, x: float, y: float, frame_id: str) -> tuple[float, float] | None:
        """Best-effort lat/lon for an incoming x/y -- None (not an
        exception) whenever the map service is unavailable or the
        projection otherwise fails, so a device/anomaly still gets
        ingested and broadcast without geo data rather than being dropped
        entirely over a map problem."""
        if not self._map_server.is_available():
            return None
        try:
            latlon = self._map_server.xy_to_latlon(x, y, frame_id)
            return latlon.lat, latlon.lon
        except MapUnavailableError:
            return None

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

        # Enrich with lat/lon once here -- MapServer is the single source of
        # truth for this projection -- so every later consumer (REST reads
        # via DeviceRegistry, and the broadcast below) gets it for free,
        # with no separate xy-to-lnglat round trip needed.
        latlon = self._project_latlon(state.pose.x, state.pose.y, state.pose.frame_id)
        if latlon is not None:
            lat, lon = latlon
            state = state.model_copy(update={"pose": state.pose.model_copy(update={"lat": lat, "lon": lon})})

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
            # Only a meaningful change (DeviceRegistry's own de-dupe) is
            # forwarded -- both coordinators watch for an
            # operational_state transition here rather than a separate
            # Zenoh subscription of their own.
            if view is not None:
                if self._anomaly_response_coordinator is not None:
                    self._anomaly_response_coordinator.on_device_state(view)
                if self._mission_drive_coordinator is not None:
                    self._mission_drive_coordinator.on_device_state(view)
        return changed

    def ingest_anomaly_payload(self, payload: bytes | str | dict) -> bool:
        """Lets a real (or simulated -- see backend/tools/anomaly_simulator.py)
        anomaly-detection service publish anomalies via Zenoh, same
        conditional-broadcast pattern as device state. Expects the same JSON
        shape as `Anomaly.model_dump(mode="json")` (see models/anomaly.py)."""
        try:
            anomaly = Anomaly(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed anomaly payload: %s", exc)
            return False

        latlon = self._project_latlon(anomaly.x, anomaly.y, anomaly.frame_id)
        if latlon is not None:
            lat, lon = latlon
            anomaly = anomaly.model_copy(update={"lat": lat, "lon": lon})

        is_new = self._anomaly_registry.get(anomaly.anomaly_id) is None
        stored = self._anomaly_registry.create(anomaly)  # create() is upsert-semantics — no existence check

        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "anomaly.created" if is_new else "anomaly.updated",
                "data": stored.model_dump(mode="json"),
            }
        )

        if is_new and self._anomaly_response_coordinator is not None:
            # Only a genuinely new anomaly should trigger a diversion -- a
            # re-published update to an already-known one must not retrigger it.
            self._anomaly_response_coordinator.on_anomaly_detected(stored)

        return True

    def publish_command(
        self, device_id: str, command: str, request_id: str, fields: dict | None = None
    ) -> bool:
        """Outbound counterpart to ingest_*: sends a GatewayCommand-shaped
        payload (see device_gateway's mission_manager_contract) to the
        named device's commands key. Returns False (never raises) when
        Zenoh isn't connected or the publish fails -- callers (the
        anomaly/mission-drive coordinators) must not block on this, only
        log and let their own timeout paths handle a command that never
        arrives."""
        if self._session is None:
            logger.warning("Cannot publish command %r to %s: Zenoh session not open", command, device_id)
            return False

        payload = {"command": command, "request_id": request_id, **(fields or {})}
        key = self._settings.zenoh_device_commands_keyexpr.format(device_id=device_id)
        try:
            self._session.put(key, json.dumps(payload).encode("utf-8"))
        except Exception:
            logger.error("Failed to publish command %r to %s", command, device_id, exc_info=True)
            return False
        return True
