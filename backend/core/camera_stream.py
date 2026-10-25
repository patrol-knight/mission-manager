"""Camera viewer sessions: admission, ownership and the gateway round trips.

One viewer per camera. A session is identified by the frontend-generated
`session_id`; the WebSocket connection that started it (`connection_id`)
owns its signaling. Neither is a credential -- they identify, they don't
authorize.

The device gateway (zenoh_bridge) is the authority on what actually runs:
this side only admits, correlates and reconciles. Commands go out on
devices/{id}/commands; their outcome comes back as a CommandResult on
devices/{id}/events, correlated by `request_id`. Camera state samples carry
(instance_id, revision), so they're applied in order (core/camera_registry.py)
whatever order Zenoh delivers them in relative to the CommandResults.

Backend session status:
  pending     Start sent, no definitive CommandResult yet
  active      gateway admitted it (running)
  cancelling  Start timed out: a Stop for it was sent, awaiting confirmation
  stopping    Stop sent, awaiting confirmation
A session is forgotten once the gateway confirms it's gone -- a succeeded
Stop, or a camera state after its admission that no longer names it -- or,
failing any confirmation, after camera_unconfirmed_expiry_sec.
"""

import asyncio
import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Literal

from config import Settings
from core.camera_registry import CameraRegistry
from core.device_registry import DeviceRegistry
from core.errors import CameraSessionError
from core.websocket_manager import WebSocketManager
from models.camera import CameraSessionInfo, CameraState, CommandResult, StartCameraStreamRequest, WebRtcSignal
from transport.zenoh_gateway import ZenohGateway

logger = logging.getLogger(__name__)

SessionStatus = Literal["pending", "active", "cancelling", "stopping"]

# Signals for a session whose owner is (briefly) disconnected, kept for when
# it resumes. Bounded; anything older than the owner grace period is
# dropped rather than replayed.
_MAX_BUFFERED_SIGNALS = 64


@dataclass
class _Session:
    session_id: str
    device_id: str
    camera_id: str
    owner: str | None  # connection_id; None for a session recovered after a backend restart
    status: SessionStatus
    # Gateway (instance_id, state revision) at admission: any later state
    # that no longer names this session means it ended.
    admitted_at: tuple[str, int] | None = None
    seen_in_state: bool = False
    owner_lost_at: float | None = None
    outbound: deque = field(default_factory=lambda: deque(maxlen=_MAX_BUFFERED_SIGNALS))


def _new_request_id() -> str:
    return f"req-{uuid.uuid4().hex[:12]}"


class CameraStreamService:
    def __init__(
        self,
        settings: Settings,
        device_registry: DeviceRegistry,
        camera_registry: CameraRegistry,
        zenoh_gateway: ZenohGateway,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._settings = settings
        self._devices = device_registry
        self._cameras = camera_registry
        self._gateway = zenoh_gateway
        self._ws = websocket_manager
        # Guards everything below; taken from the event loop and from
        # Zenoh's threads, never across an await.
        self._lock = threading.RLock()
        self._by_device: dict[str, _Session] = {}
        self._by_session: dict[str, _Session] = {}
        self._pending: dict[str, tuple[asyncio.AbstractEventLoop, asyncio.Future]] = {}

    # -- HTTP ------------------------------------------------------------------

    async def start(self, device_id: str, camera_id: str, request: StartCameraStreamRequest) -> CameraSessionInfo:
        session_id, connection_id = request.session_id, request.connection_id
        if not self._ws.is_connected(connection_id):
            raise CameraSessionError(400, "invalid_connection", "connection_id is not an open WebSocket connection")
        self._check_device(device_id, camera_id)

        with self._lock:
            existing = self._by_device.get(device_id)
            if existing is not None:
                if (
                    existing.session_id == session_id
                    and existing.owner == connection_id
                    and existing.status == "active"
                ):
                    return self._info(existing)  # duplicate Start from the same viewer
                if existing.status in ("cancelling", "stopping"):
                    raise CameraSessionError(409, "session_stopping", "the previous session is still stopping")
                raise CameraSessionError(409, "camera_busy", "camera is in use by another viewer")
            if session_id in self._by_session:
                raise CameraSessionError(409, "session_exists", "session_id already used")
            gateway_state = self._cameras.get(device_id)
            if gateway_state is not None and gateway_state.session_state != "idle":
                code = "session_stopping" if gateway_state.session_state == "stopping" else "camera_busy"
                raise CameraSessionError(409, code, "camera is in use")
            session = _Session(session_id, device_id, camera_id, connection_id, "pending")
            self._insert(session)

        try:
            result = await self._command(session, "start_camera_stream")
        except CameraSessionError:
            self._forget(session)
            raise

        if result is None:
            # No definitive answer: the gateway may still admit it. Don't let
            # it run untracked -- cancel it, and keep the session until that's
            # confirmed (or expires).
            with self._lock:
                session.status = "cancelling"
            self._spawn(self._stop_and_settle(session, reason="start_timeout"))
            raise CameraSessionError(504, "gateway_timeout", "no response from the device gateway")

        if result.status == "running":
            with self._lock:
                if session.status != "pending":
                    raise CameraSessionError(409, "session_stopping", "session was stopped while starting")
                session.status = "active"
                if result.instance_id is not None and result.state_revision is not None:
                    session.admitted_at = (result.instance_id, result.state_revision)
            self._reconcile(device_id)  # a newer state may already be here
            return self._info(session)

        self._forget(session)
        code = result.code or result.status
        if result.status == "rejected":
            status_code = 409 if code in ("camera_busy", "session_stopping") else 400
            raise CameraSessionError(status_code, code, result.message or "rejected by the device gateway")
        raise CameraSessionError(502, code, result.message or "the device gateway failed to start the stream")

    async def stop(self, device_id: str, camera_id: str, session_id: str, connection_id: str) -> bool:
        """True once the gateway confirmed the session is gone (204); False if
        it's still stopping without a confirmation yet (202)."""
        with self._lock:
            session = self._by_session.get(session_id)
            if session is None or session.device_id != device_id or session.camera_id != camera_id:
                raise CameraSessionError(404, "session_not_found", "no such camera session")
            if session.owner != connection_id:
                raise CameraSessionError(403, "not_session_owner", "this connection doesn't own the session")
            session.status = "stopping"
        return await self._stop_and_settle(session, reason="stopped")

    # -- WebSocket -------------------------------------------------------------

    def forward_inbound_signal(self, connection_id: str, data: dict) -> str | None:
        """An answer/ICE candidate from a browser. Returns an error code if
        it's not forwarded."""
        session_id = data.get("session_id")
        if not isinstance(session_id, str):
            return "missing_session_id"
        with self._lock:
            session = self._by_session.get(session_id)
            if session is None:
                return "session_not_found"
            if session.owner != connection_id:
                return "not_session_owner"
            if session.device_id != data.get("device_id") or session.camera_id != data.get("camera_id"):
                return "session_mismatch"
            if session.status not in ("pending", "active"):
                return "session_stopping"
            device_id, camera_id = session.device_id, session.camera_id
        fields = {k: v for k, v in data.items() if k not in ("device_id", "camera_id") and v is not None}
        try:
            signal = WebRtcSignal(**fields)
        except Exception:
            return "invalid_signal"
        if signal.type == "offer":
            return "invalid_signal"  # the gateway always offers
        self._gateway.publish_camera_signal(device_id, camera_id, signal.model_dump(mode="json", exclude_none=True))
        return None

    def owner_disconnected(self, connection_id: str) -> None:
        """Called when a WebSocket closes. Its sessions get the grace period
        to be resumed by a reconnecting page before they're stopped."""
        now = time.monotonic()
        with self._lock:
            sessions = [s for s in self._by_session.values() if s.owner == connection_id]
            for session in sessions:
                session.owner_lost_at = now
        for session in sessions:
            self._spawn(self._expire_ownerless(session, now))

    async def resume(self, connection_id: str, session_id: str, previous_connection_id: str | None) -> str | None:
        """Rebinds a session's signaling to a reconnected WebSocket. Returns an
        error code if it can't."""
        with self._lock:
            session = self._by_session.get(session_id)
            if session is None:
                return "session_not_found"
            if session.status not in ("pending", "active"):
                return "session_stopping"
            if session.owner is not None and session.owner != connection_id:
                if self._ws.is_connected(session.owner):
                    return "owner_connected"
                if session.owner != previous_connection_id:
                    return "not_session_owner"
            # session.owner None: recovered from the gateway after a backend
            # restart, its previous connection unknowable -- whoever presents
            # the session id may take it (session ids are not credentials).
            session.owner = connection_id
            session.owner_lost_at = None
            buffered = list(session.outbound)
            session.outbound.clear()
            state = self._cameras.get(session.device_id)
        cutoff = time.monotonic() - self._settings.camera_owner_grace_sec
        for queued_at, message in buffered:
            if queued_at >= cutoff:
                await self._ws.send_to(connection_id, message)
        if state is not None and state.session_id == session_id:
            await self._ws.send_to(connection_id, self._session_update(state))
        return None

    # -- Zenoh (called from Zenoh's threads) -------------------------------------

    def on_command_result(self, result: CommandResult) -> None:
        if result.status == "accepted":
            return  # only queued on the gateway -- not an outcome
        with self._lock:
            pending = self._pending.pop(result.request_id, None)
        if pending is None:
            return  # not ours, or it already timed out and was dropped
        loop, future = pending
        loop.call_soon_threadsafe(lambda: future.done() or future.set_result(result))

    def on_camera_state(self, state: CameraState) -> None:
        """A camera state newer than any seen before for its device."""
        with self._lock:
            session = self._by_device.get(state.device_id)
            if session is None and state.session_id is not None and state.session_state != "idle":
                if state.session_id in self._by_session:
                    return
                # The gateway holds a session this backend doesn't know --
                # it restarted since. Adopt it ownerless: a reconnecting page
                # may resume it, otherwise the grace period stops it.
                session = _Session(
                    state.session_id, state.device_id, state.camera_id, None, "active",
                    admitted_at=(state.instance_id, state.revision), seen_in_state=True,
                )
                self._insert(session)
                logger.info("Adopted camera session %s on %s from gateway state", session.session_id, state.device_id)
                now = time.monotonic()
                session.owner_lost_at = now
                self._spawn(self._expire_ownerless(session, now))
                return
        self._reconcile(state.device_id)

    def route_outbound_signal(self, device_id: str, camera_id: str, signal: WebRtcSignal) -> None:
        """An offer/ICE candidate from the gateway: to the session's owner
        only, buffered while the owner is reconnecting."""
        message = {
            "type": "camera.signal",
            "data": {"device_id": device_id, "camera_id": camera_id, **signal.model_dump(mode="json")},
        }
        with self._lock:
            session = self._by_session.get(signal.session_id)
            if session is None or session.device_id != device_id:
                logger.info("Dropping %s for unknown camera session %s", signal.type, signal.session_id)
                return
            owner = session.owner
            if owner is None or not self._ws.is_connected(owner):
                session.outbound.append((time.monotonic(), message))
                return
        self._ws.send_to_threadsafe(owner, message)

    # -- internals ---------------------------------------------------------------

    def _check_device(self, device_id: str, camera_id: str) -> None:
        device = self._devices.get(device_id)
        if device is None:
            raise CameraSessionError(404, "device_not_found", f"Device not found: {device_id}")
        # zenoh_bridge doesn't populate DeviceState.capabilities, so the
        # camera state it publishes is the reliable signal (same fallback as
        # the frontend's DeviceInspectorOverlay.tsx hasCameraCapability).
        known_camera = self._cameras.get(device_id)
        if "camera" not in device.capabilities and (known_camera is None or known_camera.camera_id != camera_id):
            raise CameraSessionError(400, "camera_unavailable", f"Device has no camera {camera_id}")
        if not device.connected:
            raise CameraSessionError(503, "device_unavailable", f"Device not connected: {device_id}")

    async def _command(self, session: _Session, command: str) -> CommandResult | None:
        """Sends a camera command and waits (camera_command_timeout_sec) for
        its definitive CommandResult. None on timeout -- the command may still
        have run."""
        request_id = _new_request_id()
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        with self._lock:
            self._pending[request_id] = (loop, future)
        fields = {"camera_id": session.camera_id, "session_id": session.session_id}
        if not self._gateway.publish_command(session.device_id, command, request_id, fields):
            with self._lock:
                self._pending.pop(request_id, None)
            raise CameraSessionError(503, "device_unreachable", f"Unable to reach device: {session.device_id}")
        try:
            return await asyncio.wait_for(asyncio.shield(future), self._settings.camera_command_timeout_sec)
        except asyncio.TimeoutError:
            # A late result is simply dropped: whoever timed out has already
            # acted on not knowing (and the camera state settles it anyway).
            with self._lock:
                self._pending.pop(request_id, None)
            return None

    async def _stop_and_settle(self, session: _Session, reason: str) -> bool:
        try:
            result = await self._command(session, "stop_camera_stream")
        except CameraSessionError:
            result = None
        confirmed = result is not None and (
            result.status == "succeeded" or (result.status == "rejected" and result.code == "session_mismatch")
        )
        if confirmed:
            # succeeded: torn down (or was never admitted); session_mismatch:
            # the gateway holds another session, so not this one.
            self._release(session, reason)
            return True
        logger.warning(
            "Camera session %s on %s not confirmed stopped (%s); waiting for gateway state",
            session.session_id, session.device_id, result.status if result else "no response",
        )
        self._spawn(self._expire_unconfirmed(session))
        return False

    async def _expire_unconfirmed(self, session: _Session) -> None:
        await asyncio.sleep(self._settings.camera_unconfirmed_expiry_sec)
        with self._lock:
            if self._by_session.get(session.session_id) is not session:
                return
        logger.warning("Forgetting camera session %s: gateway never confirmed it ended", session.session_id)
        self._release(session, "unconfirmed")

    async def _expire_ownerless(self, session: _Session, lost_at: float) -> None:
        await asyncio.sleep(self._settings.camera_owner_grace_sec)
        with self._lock:
            if self._by_session.get(session.session_id) is not session or session.owner_lost_at != lost_at:
                return  # resumed, or already gone
            if session.status in ("cancelling", "stopping"):
                return  # already being stopped
            session.status = "stopping"
        logger.info(
            "Stopping camera session %s: owner gone for %.0fs", session.session_id, self._settings.camera_owner_grace_sec
        )
        await self._stop_and_settle(session, reason="owner_disconnected")

    def _reconcile(self, device_id: str) -> None:
        """Settles the device's session against the newest camera state."""
        state = self._cameras.get(device_id)
        if state is None:
            return
        with self._lock:
            session = self._by_device.get(device_id)
            if session is None:
                return
            if state.session_id == session.session_id:
                session.seen_in_state = True
                owner = session.owner
                ended = False
            else:
                if not self._ended_by(session, state):
                    return
                ended = True
        if not ended:
            # Still running: tell its owner, if it has one right now (an
            # adopted or reconnecting session may not).
            if owner is not None:
                self._ws.send_to_threadsafe(owner, self._session_update(state))
            return
        reason = "gateway_restarted" if session.admitted_at and session.admitted_at[0] != state.instance_id else "ended"
        self._release(session, reason, state)

    @staticmethod
    def _ended_by(session: _Session, state: CameraState) -> bool:
        """Whether `state`, which doesn't name `session`, proves it ended."""
        if session.admitted_at is not None:
            instance_id, revision = session.admitted_at
            return state.instance_id != instance_id or state.revision > revision
        # Never admitted as far as we know (pending, or cancelled before an
        # answer): only a state that once named it and no longer does.
        return session.seen_in_state

    def _release(self, session: _Session, reason: str, state: CameraState | None = None) -> None:
        with self._lock:
            if self._by_session.get(session.session_id) is not session:
                return
            self._forget(session)
            owner = session.owner
        logger.info("Camera session %s on %s ended (%s)", session.session_id, session.device_id, reason)
        if owner is not None:
            self._ws.send_to_threadsafe(
                owner,
                {
                    "type": "camera.session.ended",
                    "data": {
                        "device_id": session.device_id,
                        "camera_id": session.camera_id,
                        "session_id": session.session_id,
                        "reason": reason,
                        "failure_code": state.failure_code if state else None,
                        "failure_reason": state.failure_reason if state else None,
                    },
                },
            )

    def _insert(self, session: _Session) -> None:
        self._by_device[session.device_id] = session
        self._by_session[session.session_id] = session

    def _forget(self, session: _Session) -> None:
        with self._lock:
            if self._by_session.get(session.session_id) is session:
                del self._by_session[session.session_id]
            if self._by_device.get(session.device_id) is session:
                del self._by_device[session.device_id]

    def _info(self, session: _Session) -> CameraSessionInfo:
        state = self._cameras.get(session.device_id)
        known = state is not None and state.session_id == session.session_id
        session_state = state.session_state if known else "starting"
        return CameraSessionInfo(
            device_id=session.device_id,
            camera_id=session.camera_id,
            session_id=session.session_id,
            session_state=session_state,
        )

    @staticmethod
    def _session_update(state: CameraState) -> dict:
        return {"type": "camera.session.updated", "data": state.model_dump(mode="json")}

    def _spawn(self, coro) -> None:
        self._ws.run_coroutine_threadsafe(coro)
