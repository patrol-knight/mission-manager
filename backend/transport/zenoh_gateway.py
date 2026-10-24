import json
import logging
import re
import time
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.camera_registry import CameraRegistry
from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError, MapUnavailableError
from core.map_server import MapServer
from core.websocket_manager import WebSocketManager
from models.anomaly import AnomalyFeedbackMessage, AnomalyStateMessage
from models.camera import CameraState, WebRtcSignal
from models.device import DeviceState

# Matches devices/{device_id}/cameras/{camera_id}/webrtc/to-backend --
# WebRtcSignalPayload's own JSON body carries only session_id/type/sdp/candidate, so
# device_id/camera_id have to come from the sample's key expression itself.
_CAMERA_SIGNAL_KEY_RE = re.compile(
    r"^devices/(?P<device_id>[^/]+)/cameras/(?P<camera_id>[^/]+)/webrtc/to-backend$"
)

if TYPE_CHECKING:
    from core.investigation import InvestigationCoordinator
    from core.mission_drive import MissionDriveCoordinator

logger = logging.getLogger(__name__)


class ZenohGateway:
    """Zenoh integration boundary.

    Real `zenoh` is imported lazily inside `start()` so this module — and
    `ingest_device_payload()`/`ingest_anomaly_payload()` in particular — stays
    importable and testable when `eclipse-zenoh` is not installed or
    ZENOH_ENABLED=false.

    `investigation`/`mission_drive_coordinator` are bound
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
        camera_registry: CameraRegistry,
    ) -> None:
        self._settings = settings
        self._device_registry = device_registry
        self._websocket_manager = websocket_manager
        self._anomaly_registry = anomaly_registry
        self._map_server = map_server
        self._camera_registry = camera_registry
        self._investigation: "InvestigationCoordinator | None" = None
        self._mission_drive_coordinator: "MissionDriveCoordinator | None" = None
        self._session = None
        self._device_subscriber = None
        self._anomaly_subscriber = None
        self._camera_state_subscriber = None
        self._camera_signal_subscriber = None
        # device_id -> ((x, y, frame_id), (lat, lon)): towers never move.
        self._last_projection: dict[str, tuple[tuple[float, float, str], tuple[float, float] | None]] = {}

    def bind_coordinators(
        self,
        investigation: "InvestigationCoordinator",
        mission_drive_coordinator: "MissionDriveCoordinator",
    ) -> None:
        self._investigation = investigation
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
            self._camera_state_subscriber = self._session.declare_subscriber(
                self._settings.zenoh_camera_state_keyexpr,
                self._on_zenoh_camera_state_sample,
            )
            self._camera_signal_subscriber = self._session.declare_subscriber(
                self._settings.zenoh_camera_webrtc_to_backend_keyexpr,
                self._on_zenoh_camera_signal_sample,
            )
            logger.info(
                "Zenoh session opened on %s; subscribed to %s, %s, %s, and %s",
                self._settings.zenoh_router,
                self._settings.zenoh_device_state_keyexpr,
                self._settings.zenoh_anomaly_keyexpr,
                self._settings.zenoh_camera_state_keyexpr,
                self._settings.zenoh_camera_webrtc_to_backend_keyexpr,
            )
        except Exception:
            self._session = None
            self._device_subscriber = None
            self._anomaly_subscriber = None
            self._camera_state_subscriber = None
            self._camera_signal_subscriber = None
            logger.error("Failed to start Zenoh gateway", exc_info=True)
            raise

    def stop(self) -> None:
        if self._device_subscriber is not None:
            self._device_subscriber.undeclare()
            self._device_subscriber = None
        if self._anomaly_subscriber is not None:
            self._anomaly_subscriber.undeclare()
            self._anomaly_subscriber = None
        if self._camera_state_subscriber is not None:
            self._camera_state_subscriber.undeclare()
            self._camera_state_subscriber = None
        if self._camera_signal_subscriber is not None:
            self._camera_signal_subscriber.undeclare()
            self._camera_signal_subscriber = None
        if self._session is not None:
            self._session.close()
            self._session = None
        logger.info("Zenoh gateway stopped")

    def _on_zenoh_device_sample(self, sample) -> None:
        # Zenoh invokes this from its own thread, not the asyncio event loop.
        self.ingest_device_payload(bytes(sample.payload))

    def _on_zenoh_anomaly_sample(self, sample) -> None:
        self.ingest_anomaly_payload(bytes(sample.payload))

    def _on_zenoh_camera_state_sample(self, sample) -> None:
        self.ingest_camera_state_payload(bytes(sample.payload))

    def _on_zenoh_camera_signal_sample(self, sample) -> None:
        self.ingest_camera_signal_payload(bytes(sample.payload), str(sample.key_expr))

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
        at = (state.pose.x, state.pose.y, state.pose.frame_id)
        last = self._last_projection.get(state.device_id)
        if last is not None and last[0] == at:
            latlon = last[1]
        else:
            latlon = self._project_latlon(*at)
            if latlon is not None:
                self._last_projection[state.device_id] = (at, latlon)
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
                if self._investigation is not None:
                    self._investigation.on_device_state(view)
                if self._mission_drive_coordinator is not None:
                    self._mission_drive_coordinator.on_device_state(view)
        return changed

    def ingest_anomaly_payload(
        self,
        payload: bytes | str | dict,
        received_at: float | None = None,
    ) -> bool:
        """Anomaly state messages from the anomaly-detection service
        (../anomaly_detection/docs/topics_format.md section 2.1). The first
        message for an id creates the anomaly, later ones refresh it; refreshes
        of an already-resolved anomaly are ignored (feedback delivery is
        best-effort, so the producer may not have stopped yet). Returns True
        if the message was applied."""
        received_at = time.time() if received_at is None else received_at

        try:
            message = AnomalyStateMessage(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed anomaly payload: %s", exc)
            return False

        result = self._anomaly_registry.ingest(
            message,
            received_at=datetime.fromtimestamp(received_at, timezone.utc),
            latlon=self._project_latlon(message.x, message.y, message.frame_id),
        )
        if result is None:
            logger.debug("Ignoring refresh of resolved anomaly %s", message.anomaly_id)
            return False
        stored, is_new = result

        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "anomaly.created" if is_new else "anomaly.updated",
                "data": stored.model_dump(mode="json"),
            }
        )
        return True

    def ingest_camera_state_payload(self, payload: bytes | str | dict) -> bool:
        """CameraStatePayload from zenoh_bridge's per-camera frame-arrival
        watchdog (idle/connecting/live/no_signal/offline/error). Same
        conditional-broadcast pattern as device state."""
        try:
            state = CameraState(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed camera state payload: %s", exc)
            return False

        changed = self._camera_registry.upsert(state)
        if changed:
            self._websocket_manager.broadcast_threadsafe(
                {"type": "camera.updated", "data": state.model_dump(mode="json")}
            )
        return changed

    def ingest_camera_signal_payload(self, payload: bytes | str | dict, key_expr: str) -> bool:
        """WebRtcSignalPayload (offer/answer/ice-candidate) relayed from
        zenoh_bridge's WebRtcSignalingBridge -- forwarded to the browser
        over the existing WebSocket rather than a new REST endpoint, per
        the design doc. device_id/camera_id come from the key expression,
        not the payload body (see _CAMERA_SIGNAL_KEY_RE)."""
        match = _CAMERA_SIGNAL_KEY_RE.match(key_expr)
        if match is None:
            logger.warning("Discarding camera signal on unrecognized key: %s", key_expr)
            return False

        try:
            signal = WebRtcSignal(**self._decode_json_payload(payload))
        except Exception as exc:
            logger.warning("Discarding malformed camera signal payload: %s", exc)
            return False

        self._websocket_manager.broadcast_threadsafe(
            {
                "type": "camera.signal",
                "data": {
                    "device_id": match.group("device_id"),
                    "camera_id": match.group("camera_id"),
                    **signal.model_dump(mode="json"),
                },
            }
        )
        return True

    def publish_camera_signal(self, device_id: str, camera_id: str, signal: dict) -> bool:
        """Outbound counterpart to ingest_camera_signal_payload: relays the
        browser's answer/ICE (received over the WebSocket) to the device's
        gateway. Same never-raises, log-and-return-False contract as
        publish_command -- the frontend's own negotiation timeout is what
        handles a signal that never arrives."""
        if self._session is None:
            logger.warning(
                "Cannot publish camera signal to %s/%s: Zenoh session not open", device_id, camera_id
            )
            return False

        key = self._settings.zenoh_camera_webrtc_to_device_keyexpr.format(
            device_id=device_id, camera_id=camera_id
        )
        try:
            self._session.put(key, json.dumps(signal).encode("utf-8"))
        except Exception:
            logger.error("Failed to publish camera signal to %s/%s", device_id, camera_id, exc_info=True)
            return False
        return True

    def publish_anomaly_feedback(self, anomaly_id: str, resolution: str, resolved_at: datetime) -> bool:
        """Tells Anomaly Detection the operator's verdict on anomalies/{id}/
        feedback (section 2.2 of the same doc), after which it stops
        publishing that id. Same never-raises, log-and-return-False contract
        as publish_command -- the verdict is already recorded locally, and
        ingest ignores any refreshes that keep arriving."""
        if self._session is None:
            logger.warning("Cannot publish feedback for anomaly %s: Zenoh session not open", anomaly_id)
            return False

        message = AnomalyFeedbackMessage(
            anomaly_id=anomaly_id, resolution=resolution, resolved_at=resolved_at.timestamp()
        )
        key = self._settings.zenoh_anomaly_feedback_keyexpr.format(anomaly_id=anomaly_id)
        try:
            self._session.put(key, message.model_dump_json().encode("utf-8"))
        except Exception:
            logger.error("Failed to publish feedback for anomaly %s", anomaly_id, exc_info=True)
            return False
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
