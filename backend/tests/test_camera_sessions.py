"""Camera viewer sessions end to end through the backend: REST admission,
CommandResult correlation, owner-only signaling, reconnect/resume, and
reconciliation against ordered gateway camera states. The device gateway is
FakeGateway below -- same admission rules and result codes as zenoh_bridge's
CameraGatewayComponent, answering from another thread like Zenoh does."""

import threading
import time
from contextlib import ExitStack
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import create_app
from config import Settings

DEVICE = "iot-1"
CAMERA = "front"
SESSION_A = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
SESSION_B = "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class FakeGateway:
    def __init__(self, services, monkeypatch: pytest.MonkeyPatch) -> None:
        self._gateway = services.zenoh_gateway
        self.instance_id = "inst-1"
        self.revision = 0
        self.session_id: str | None = None
        self.session_state = "idle"
        self.failure_code: str | None = None
        self.commands: list[tuple[str, dict]] = []
        self.signals: list[dict] = []
        self.respond = True  # False: swallow commands (no CommandResult at all)
        self.held: list[tuple[str, str, dict]] = []
        self._lock = threading.Lock()
        monkeypatch.setattr(self._gateway, "publish_command", self._on_command)
        monkeypatch.setattr(
            self._gateway, "publish_camera_signal", lambda d, c, signal: self.signals.append(signal) or True
        )

    # -- what the real gateway publishes -------------------------------------

    def publish_state(self, **overrides) -> dict:
        with self._lock:
            self.revision += 1
            state = {
                "device_id": DEVICE,
                "camera_id": CAMERA,
                "stream_state": "connecting" if self.session_id else "idle",
                "failure_reason": None,
                "timestamp": _now(),
                "session_id": self.session_id,
                "session_state": self.session_state,
                "video_source": None,
                "failure_code": self.failure_code,
                "instance_id": self.instance_id,
                "revision": self.revision,
            } | overrides
        self._gateway.ingest_camera_state_payload(state)
        return state

    def result(self, request_id: str, command: str, status: str, session_id: str | None, code: str | None = None):
        self._gateway.ingest_command_result_payload(
            {
                "request_id": request_id,
                "device_id": DEVICE,
                "command": command,
                "status": status,
                "message": None,
                "timestamp": _now(),
                "session_id": session_id,
                "code": code,
                "instance_id": self.instance_id,
                "state_revision": self.revision,
            }
        )

    def offer(self, session_id: str) -> None:
        self._gateway.ingest_camera_signal_payload(
            {"session_id": session_id, "type": "offer", "sdp": "v=0 offer"},
            f"devices/{DEVICE}/cameras/{CAMERA}/webrtc/to-backend",
        )

    # -- command handling ------------------------------------------------------

    def _on_command(self, device_id: str, command: str, request_id: str, fields: dict | None = None) -> bool:
        self.commands.append((command, fields or {}))
        if self.respond:
            threading.Timer(0.01, self.handle, (command, request_id, fields or {})).start()
        else:
            self.held.append((command, request_id, fields or {}))
        return True

    def release_held(self) -> None:
        held, self.held = self.held, []
        for command, request_id, fields in held:
            self.handle(command, request_id, fields)

    def handle(self, command: str, request_id: str, fields: dict) -> None:
        session_id = fields.get("session_id")
        self.result(request_id, command, "accepted", None)  # queued -- never an outcome
        if command == "start_camera_stream":
            if self.session_id is None:
                self.session_id, self.session_state, self.failure_code = session_id, "starting", None
                self.publish_state()
                self.result(request_id, command, "running", session_id)
            elif self.session_id == session_id:
                self.result(request_id, command, "running", session_id)
            else:
                self.result(request_id, command, "rejected", session_id, "camera_busy")
        elif command == "stop_camera_stream":
            if self.session_id is None:
                self.result(request_id, command, "succeeded", session_id, "not_active")
            elif self.session_id != session_id:
                self.result(request_id, command, "rejected", session_id, "session_mismatch")
            else:
                self.session_state = "stopping"
                self.publish_state()
                self.session_id, self.session_state = None, "idle"
                self.publish_state()
                self.result(request_id, command, "succeeded", session_id)

    def commands_named(self, name: str) -> list[dict]:
        return [fields for command, fields in self.commands if command == name]


@pytest.fixture
def fast_settings(settings: Settings) -> Settings:
    settings.camera_command_timeout_sec = 0.5
    settings.camera_owner_grace_sec = 0.5
    settings.camera_unconfirmed_expiry_sec = 2.0
    return settings


@pytest.fixture
def client(fast_settings: Settings):
    with TestClient(create_app(fast_settings)) as test_client:
        yield test_client


@pytest.fixture
def gateway(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> FakeGateway:
    services = client.app.state.services
    services.zenoh_gateway.ingest_device_payload(
        {"device_id": DEVICE, "type": "iot", "pose": {"x": 0.0, "y": 0.0}, "timestamp": time.time()}
    )
    fake = FakeGateway(services, monkeypatch)
    fake.publish_state()  # the gateway's initial idle announce
    return fake


class Viewer:
    """One browser tab: a WebSocket plus the connection_id it was given."""

    def __init__(self, client: TestClient, stack: ExitStack) -> None:
        self.client = client
        self.ws = stack.enter_context(client.websocket_connect("/ws"))
        ready = self.ws.receive_json()
        assert ready["type"] == "connection.ready"
        self.connection_id = ready["data"]["connection_id"]
        self.drain()

    def drain(self) -> list[dict]:
        """Everything received so far (up to a ping/pong round trip)."""
        self.ws.send_json({"type": "ping"})
        received = []
        while True:
            message = self.ws.receive_json()
            if message["type"] == "pong":
                return received
            received.append(message)

    def wait_for(self, message_type: str, timeout: float = 3.0) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for message in self.drain():
                if message["type"] == message_type:
                    return message
            time.sleep(0.02)
        raise AssertionError(f"no {message_type} within {timeout}s")

    def start(self, session_id: str):
        return self.client.post(
            f"/api/cameras/{DEVICE}/{CAMERA}/stream",
            json={"session_id": session_id, "connection_id": self.connection_id},
        )

    def stop(self, session_id: str, connection_id: str | None = None):
        return self.client.post(
            f"/api/cameras/{DEVICE}/{CAMERA}/stream/{session_id}/stop",
            json={"connection_id": connection_id or self.connection_id},
        )


def wait_until(predicate, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def test_start_needs_an_open_connection_and_a_session_id(client: TestClient, gateway: FakeGateway):
    url = f"/api/cameras/{DEVICE}/{CAMERA}/stream"
    response = client.post(url, json={"session_id": SESSION_A, "connection_id": "not-a-connection"})
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_connection"
    assert client.post(url, json={"session_id": "x", "connection_id": "c"}).status_code == 422
    assert gateway.commands == []


def test_start_admits_one_viewer_and_a_second_gets_409(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner, other = Viewer(client, stack), Viewer(client, stack)
        response = owner.start(SESSION_A)
        assert response.status_code == 201, response.text
        assert response.json() == {
            "device_id": DEVICE, "camera_id": CAMERA, "session_id": SESSION_A, "session_state": "starting",
        }
        assert gateway.commands_named("start_camera_stream") == [{"camera_id": CAMERA, "session_id": SESSION_A}]

        assert owner.start(SESSION_A).status_code == 201  # duplicate Start: idempotent
        busy = other.start(SESSION_B)
        assert busy.status_code == 409
        assert busy.json()["code"] == "camera_busy"
        assert len(gateway.commands_named("start_camera_stream")) == 1  # never reached the gateway


def test_gateway_rejection_is_a_409_and_frees_the_slot(client: TestClient, gateway: FakeGateway):
    gateway.session_id = "33333333-cccc-4ccc-8ccc-cccccccccccc"  # held, but its state never reached us
    with ExitStack() as stack:
        viewer = Viewer(client, stack)
        response = viewer.start(SESSION_A)
        assert response.status_code == 409
        assert response.json()["code"] == "camera_busy"
        gateway.session_id = None
        assert viewer.start(SESSION_B).status_code == 201


def test_unavailable_device_is_503(client: TestClient, gateway: FakeGateway, monkeypatch: pytest.MonkeyPatch):
    registry = client.app.state.services.device_registry
    original = registry.get
    with ExitStack() as stack:
        viewer = Viewer(client, stack)
        monkeypatch.setattr(
            registry, "get", lambda device_id: original(device_id).model_copy(update={"connected": False})
        )
        response = viewer.start(SESSION_A)
        assert response.status_code == 503
        assert response.json()["code"] == "device_unavailable"


def test_start_timeout_is_504_and_cancels_the_session(client: TestClient, gateway: FakeGateway):
    gateway.respond = False
    with ExitStack() as stack:
        viewer = Viewer(client, stack)
        response = viewer.start(SESSION_A)
        assert response.status_code == 504
        # The backend didn't leave it running untracked: it sent a Stop for
        # the very same session.
        assert wait_until(lambda: len(gateway.commands_named("stop_camera_stream")) == 1)
        assert gateway.commands_named("stop_camera_stream")[0]["session_id"] == SESSION_A

        # Until that's confirmed, the camera isn't free.
        retry = viewer.start(SESSION_B)
        assert retry.status_code == 409
        assert retry.json()["code"] == "session_stopping"

        # The gateway now runs the late Start, then the Stop (same key, same
        # order). The late "running" must not revive the cancelled session.
        gateway.respond = True
        gateway.release_held()
        assert gateway.session_id is None
        assert wait_until(lambda: viewer.start(SESSION_B).status_code == 201)


def test_stop_requires_the_owner_and_the_right_session(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner, other = Viewer(client, stack), Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201

        response = other.stop(SESSION_A)
        assert response.status_code == 403
        assert response.json()["code"] == "not_session_owner"
        response = owner.stop(SESSION_B)
        assert response.status_code == 404
        assert gateway.commands_named("stop_camera_stream") == []

        assert owner.stop(SESSION_A).status_code == 204
        assert gateway.session_id is None
        assert owner.wait_for("camera.session.ended")["data"]["session_id"] == SESSION_A
        assert other.start(SESSION_B).status_code == 201  # free again


def test_stop_accepts_a_text_plain_beacon(client: TestClient, gateway: FakeGateway):
    # navigator.sendBeacon from a closing page: text/plain keeps it a CORS
    # simple request, so the body must be parsed regardless of content type.
    with ExitStack() as stack:
        owner = Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
        response = client.post(
            f"/api/cameras/{DEVICE}/{CAMERA}/stream/{SESSION_A}/stop",
            content=f'{{"connection_id": "{owner.connection_id}"}}',
            headers={"Content-Type": "text/plain;charset=UTF-8"},
        )
        assert response.status_code == 204
        assert gateway.session_id is None
        bad = client.post(f"/api/cameras/{DEVICE}/{CAMERA}/stream/{SESSION_A}/stop", content="not json")
        assert bad.status_code == 422


def test_stale_stop_cannot_end_a_newer_session(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        first, second = Viewer(client, stack), Viewer(client, stack)
        assert first.start(SESSION_A).status_code == 201
        assert first.stop(SESSION_A).status_code == 204
        assert second.start(SESSION_B).status_code == 201
        assert first.stop(SESSION_A).status_code == 404  # A is gone; B untouched
        assert gateway.session_id == SESSION_B


def test_signaling_goes_only_to_the_owner(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner, other = Viewer(client, stack), Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
        gateway.offer(SESSION_A)
        assert owner.wait_for("camera.signal")["data"]["sdp"] == "v=0 offer"
        assert not [m for m in other.drain() if m["type"] == "camera.signal"]

        answer = {"device_id": DEVICE, "camera_id": CAMERA, "session_id": SESSION_A, "type": "answer", "sdp": "v=0 a"}
        other.ws.send_json({"type": "camera.signal", "data": answer})
        assert other.wait_for("camera.signal.rejected")["data"]["code"] == "not_session_owner"
        assert gateway.signals == []

        owner.ws.send_json({"type": "camera.signal", "data": answer})
        assert wait_until(lambda: gateway.signals == [{"session_id": SESSION_A, "type": "answer", "sdp": "v=0 a"}])

        stale = answer | {"session_id": SESSION_B}
        owner.ws.send_json({"type": "camera.signal", "data": stale})
        assert owner.wait_for("camera.signal.rejected")["data"]["code"] == "session_not_found"


def test_other_viewers_see_availability_but_not_the_session_id(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner, other = Viewer(client, stack), Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
        update = other.wait_for("camera.updated")["data"]
        assert update["session_state"] == "starting"
        assert update["session_id"] is None
        assert owner.wait_for("camera.session.updated")["data"]["session_id"] == SESSION_A


def test_owner_disconnect_stops_the_session_after_the_grace_period(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner = Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
    # Tab closed without a Stop.
    expected_stop = [{"camera_id": CAMERA, "session_id": SESSION_A}]
    assert wait_until(lambda: gateway.commands_named("stop_camera_stream") == expected_stop)
    assert wait_until(lambda: gateway.session_id is None)
    with ExitStack() as stack:
        assert Viewer(client, stack).start(SESSION_B).status_code == 201


def test_reconnecting_owner_resumes_and_gets_buffered_signals(client: TestClient, gateway: FakeGateway):
    with ExitStack() as first_stack:
        first = Viewer(client, first_stack)
        assert first.start(SESSION_A).status_code == 201
        previous = first.connection_id
    gateway.offer(SESSION_A)  # arrives while the owner is reconnecting

    with ExitStack() as stack:
        again = Viewer(client, stack)
        again.ws.send_json(
            {"type": "camera.session.resume", "data": {"session_id": SESSION_A, "previous_connection_id": previous}}
        )
        received = []
        deadline = time.monotonic() + 3
        while not any(m["type"] == "camera.session.resumed" for m in received) and time.monotonic() < deadline:
            received += again.drain()
        types = [m["type"] for m in received]
        assert "camera.session.resumed" in types
        assert "camera.signal" in types  # the offer buffered during the outage
        time.sleep(0.8)  # past the grace period
        assert gateway.commands_named("stop_camera_stream") == []

        # Someone else can't take it over while its owner is connected.
        with ExitStack() as other_stack:
            other = Viewer(client, other_stack)
            other.ws.send_json(
                {"type": "camera.session.resume", "data": {"session_id": SESSION_A, "previous_connection_id": previous}}
            )
            assert other.wait_for("camera.session.resume_failed")["data"]["code"] == "owner_connected"
        assert again.stop(SESSION_A).status_code == 204


def test_older_camera_states_never_regress_newer_ones(client: TestClient, gateway: FakeGateway):
    services = client.app.state.services
    newest = gateway.publish_state(session_state="idle")
    stale = newest | {"revision": newest["revision"] - 1, "session_state": "stopping", "session_id": SESSION_A}
    assert services.zenoh_gateway.ingest_camera_state_payload(stale) is False
    assert services.zenoh_gateway.ingest_camera_state_payload(newest) is False  # periodic re-publish
    assert services.camera_registry.get(DEVICE).revision == newest["revision"]


def test_gateway_restart_ends_the_session(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner = Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
        gateway.instance_id, gateway.revision = "inst-2", 0
        gateway.session_id, gateway.session_state = None, "idle"
        gateway.publish_state()
        ended = owner.wait_for("camera.session.ended")["data"]
        assert ended["session_id"] == SESSION_A
        assert ended["reason"] == "gateway_restarted"
        assert owner.start(SESSION_B).status_code == 201


def test_session_ended_by_the_gateway_is_released(client: TestClient, gateway: FakeGateway):
    with ExitStack() as stack:
        owner = Viewer(client, stack)
        assert owner.start(SESSION_A).status_code == 201
        # e.g. the gateway's negotiation timeout
        gateway.session_state = "stopping"
        gateway.failure_code = "negotiation_timeout"
        gateway.publish_state()
        gateway.session_id, gateway.session_state = None, "idle"
        gateway.publish_state()
        ended = owner.wait_for("camera.session.ended")["data"]
        assert ended["failure_code"] == "negotiation_timeout"
        assert owner.start(SESSION_B).status_code == 201


def test_backend_restart_adopts_the_gateways_session(client: TestClient, gateway: FakeGateway):
    # The gateway still streams a session this (fresh) backend never saw.
    gateway.session_id, gateway.session_state = SESSION_A, "streaming"
    gateway.publish_state()
    with ExitStack() as stack:
        page = Viewer(client, stack)  # the page's WebSocket reconnected to the new backend
        page.ws.send_json(
            {"type": "camera.session.resume", "data": {"session_id": SESSION_A, "previous_connection_id": "old"}}
        )
        page.wait_for("camera.session.resumed")
        time.sleep(0.8)
        assert gateway.commands_named("stop_camera_stream") == []
        assert page.stop(SESSION_A).status_code == 204


def test_adopted_session_survives_state_changes_until_resumed(client: TestClient, gateway: FakeGateway):
    gateway.session_id, gateway.session_state = SESSION_A, "streaming"
    gateway.publish_state()
    gateway.publish_state(video_source="no_signal")  # the camera drops out before anyone resumes
    gateway.publish_state(video_source="live")
    with ExitStack() as stack:
        page = Viewer(client, stack)
        page.ws.send_json(
            {"type": "camera.session.resume", "data": {"session_id": SESSION_A, "previous_connection_id": "old"}}
        )
        page.wait_for("camera.session.resumed")
        assert page.stop(SESSION_A).status_code == 204


def test_unclaimed_adopted_session_is_stopped(client: TestClient, gateway: FakeGateway):
    gateway.session_id, gateway.session_state = SESSION_A, "streaming"
    gateway.publish_state()
    expected_stop = [{"camera_id": CAMERA, "session_id": SESSION_A}]
    assert wait_until(lambda: gateway.commands_named("stop_camera_stream") == expected_stop)
    assert wait_until(lambda: gateway.session_id is None)
