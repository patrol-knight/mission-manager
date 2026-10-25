"""Anomaly ingest, lifetime and verdicts against ../anomaly_detection/docs/topics_format.md
section 2, at the registry/gateway level (no app)."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from transport.zenoh_gateway import ZenohGateway

AID = "6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b"
T0 = 1_800_000_000.0
MESSAGE = {
    "anomaly_id": AID,
    "types": ["lying_down", "loitering"],
    "x": 12.4,
    "y": -3.1,
    "frame_id": "map",
    "confidence": 0.92,
    "source_device_id": "iot-01",
    "detected_at": 1759665600.123,
    "updated_at": 1759665620.456,
    "degrade_sec": 30.0,
}


def at(seconds: float) -> datetime:
    return datetime.fromtimestamp(T0 + seconds, timezone.utc)


class FakeRepository:
    def __init__(self):
        self.rows = []

    def record_final(self, anomaly, closed_at):
        self.rows.append((anomaly.anomaly_id, anomaly.resolution, closed_at))


class FakeWebSocket:
    def __init__(self):
        self.events = []

    def broadcast_threadsafe(self, event):
        self.events.append(event)


class NoMap:
    def is_available(self):
        return False


class FakeSession:
    def __init__(self):
        self.puts = []

    def put(self, key, value):
        self.puts.append((key, json.loads(value)))


@pytest.fixture
def repo():
    return FakeRepository()


@pytest.fixture
def registry(repo):
    return AnomalyRegistry(repository=repo)


@pytest.fixture
def ws():
    return FakeWebSocket()


@pytest.fixture
def gateway(registry, ws):
    return ZenohGateway(Settings(_env_file=None), None, ws, registry, NoMap(), None)


def test_first_message_creates_the_anomaly(gateway, registry, ws):
    assert gateway.ingest_anomaly_payload(json.dumps(MESSAGE).encode(), received_at=T0)
    anomaly = registry.get(AID)
    assert anomaly.types == ["lying_down", "loitering"]
    assert anomaly.expires_at == at(30)
    assert anomaly.detected_at == datetime.fromtimestamp(MESSAGE["detected_at"], timezone.utc)
    assert ws.events[-1]["type"] == "anomaly.updated"


def test_refresh_only_ever_extends_the_lifetime_and_keeps_first_values(gateway, registry, ws):
    gateway.ingest_anomaly_payload(MESSAGE, received_at=T0)
    gateway.ingest_anomaly_payload(
        {**MESSAGE, "degrade_sec": 5.0, "source_device_id": "x", "detected_at": 1.0, "types": ["trespassing"]},
        received_at=T0 + 10,
    )
    anomaly = registry.get(AID)
    assert anomaly.expires_at == at(30)  # 10 + 5 is earlier: never shortened
    assert anomaly.source_device_id == "iot-01"
    assert anomaly.types == ["trespassing"]
    assert anomaly.last_seen_at == at(10)

    gateway.ingest_anomaly_payload({**MESSAGE, "degrade_sec": 60.0}, received_at=T0 + 20)
    assert registry.get(AID).expires_at == at(80)
    assert ws.events[-1]["type"] == "anomaly.updated"


@pytest.mark.parametrize(
    "payload",
    [
        {**MESSAGE, "types": []},
        {**MESSAGE, "types": ["unknown"]},
        {**MESSAGE, "types": ["loitering", "loitering"]},
        {**MESSAGE, "frame_id": "odom"},
        {**MESSAGE, "confidence": 1.5},
        {**MESSAGE, "degrade_sec": 0},
        '{"anomaly_id": "x", "x": NaN}',
    ],
)
def test_malformed_messages_are_rejected(gateway, payload):
    assert not gateway.ingest_anomaly_payload(payload, received_at=T0)


def test_unknown_fields_are_tolerated(gateway):
    assert gateway.ingest_anomaly_payload({**MESSAGE, "future_field": 1}, received_at=T0)


def test_expiry_skips_the_target_and_releasing_it_gives_a_fresh_grace_period(gateway, registry, repo):
    gateway.ingest_anomaly_payload(MESSAGE, received_at=T0)
    assert registry.expire(now=at(29)) == []

    assert registry.set_target(AID).anomaly_id == AID
    assert registry.expire(now=at(500)) == []  # the robot is investigating it

    registry.set_target(None)
    released = registry.get(AID)
    assert released.expires_at > datetime.now(timezone.utc) + timedelta(seconds=25)

    assert registry.expire(now=released.expires_at) == [AID]
    assert repo.rows == [(AID, None, released.expires_at)]  # never visited -> NULL
    assert registry.get(AID) is None


def test_an_expired_open_anomaly_can_be_created_again(gateway, registry, ws):
    gateway.ingest_anomaly_payload(MESSAGE, received_at=T0)
    registry.expire(now=at(31))
    assert gateway.ingest_anomaly_payload(MESSAGE, received_at=T0 + 100)
    assert ws.events[-1]["type"] == "anomaly.updated"


def test_unclear_is_recorded_but_not_final(gateway, registry, repo):
    gateway.ingest_anomaly_payload(MESSAGE, received_at=T0)
    assert registry.resolve(AID, "unclear", None).resolution == "unclear"
    assert repo.rows == []  # written only when it finally expires
    assert gateway.ingest_anomaly_payload(MESSAGE, received_at=T0 + 1)  # refreshes still apply

    registry.expire(now=at(1000))
    assert repo.rows[-1][:2] == (AID, "unclear")


def test_a_final_verdict_closes_the_anomaly_for_good(gateway, registry, repo):
    gateway.ingest_anomaly_payload(MESSAGE, received_at=T0)
    resolved = registry.resolve(AID, "false_positive", "m-1")
    assert resolved.resolution == "false_positive" and resolved.mission_id == "m-1"
    assert repo.rows[-1][:2] == (AID, "false_positive")

    assert not gateway.ingest_anomaly_payload(MESSAGE, received_at=T0 + 1)  # refresh ignored
    assert registry.set_target(AID) is None  # can't be investigated
    assert registry.expire(now=resolved.expires_at) == [AID]
    assert len(repo.rows) == 1  # no second write
    assert not gateway.ingest_anomaly_payload(MESSAGE, received_at=T0 + 5000)  # still ignored after removal
    assert registry.get(AID) is None

    registry.expire(now=resolved.expires_at + timedelta(hours=2))  # forgotten after the retention
    assert gateway.ingest_anomaly_payload(MESSAGE, received_at=T0 + 9000)


def test_feedback_payload_matches_the_contract(gateway):
    resolved_at = at(42)
    assert not gateway.publish_anomaly_feedback(AID, "true_positive", resolved_at)  # no Zenoh session
    gateway._session = FakeSession()
    assert gateway.publish_anomaly_feedback(AID, "true_positive", resolved_at)
    assert gateway._session.puts == [
        (
            f"anomalies/{AID}/feedback",
            {"anomaly_id": AID, "resolution": "true_positive", "resolved_at": resolved_at.timestamp()},
        )
    ]
