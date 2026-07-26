#!/usr/bin/env python3
"""Simulates a remote anomaly-detection service.

The real thing will run on a separate desktop/GPU machine, not on the
robot or any device_gateway -- it subscribes to device state over Zenoh
and publishes detections directly, with no ROS 2 involved. This script
mimics that shape: it subscribes to IoT device positions and "detects" an
anomaly at a random position within a radius of one of them (anomalies
happen near IoT sensors in this fleet), publishing (x, y, time,
confidence, ...) the same way a real detector would.

Deliberately has no import from the backend package -- a real detector is
a separate process with no code dependency on this repo, only the Zenoh
wire contract: mission-manager/anomalies/{anomaly_id}/state, matching
backend/models/anomaly.py's Anomaly shape.

Default is one anomaly then exit -- a deterministic test scenario, and the
one you want for the anomaly-diversion golden path (raise one, watch the
robot investigate it, verify/dismiss, watch it resume):
    .venv/bin/python3 tools/anomaly_simulator.py --zenoh-router tcp/localhost:7447

For the old continuous background-demo behavior (a new anomaly every
15-45s, forever) use --loop:
    .venv/bin/python3 tools/anomaly_simulator.py --loop
"""

import argparse
import json
import math
import random
import threading
import time
import uuid
from datetime import datetime, timezone

import zenoh

DEVICE_STATE_KEY = "mission-manager/devices/*/state"


def anomaly_key(anomaly_id: str) -> str:
    return f"mission-manager/anomalies/{anomaly_id}/state"


def iso8601_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class IotPositionTracker:
    """Tracks the latest (x, y) of every iot-type device seen on Zenoh."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._positions: dict[str, tuple[float, float]] = {}

    def on_sample(self, sample: "zenoh.Sample") -> None:
        try:
            payload = json.loads(bytes(sample.payload).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return
        if payload.get("type") != "iot":
            return
        pose = payload.get("pose") or {}
        device_id = payload.get("device_id")
        x, y = pose.get("x"), pose.get("y")
        if device_id is None or x is None or y is None:
            return
        with self._lock:
            self._positions[device_id] = (x, y)

    def random_device(self) -> tuple[str, float, float] | None:
        with self._lock:
            if not self._positions:
                return None
            device_id = random.choice(list(self._positions))
            x, y = self._positions[device_id]
        return device_id, x, y


def random_offset(radius_m: float) -> tuple[float, float]:
    """Uniform-random point within a disk of the given radius."""
    r = radius_m * math.sqrt(random.random())
    theta = random.uniform(0.0, 2.0 * math.pi)
    return r * math.cos(theta), r * math.sin(theta)


def build_anomaly_payload(source_device_id: str, x: float, y: float, confidence: float) -> dict:
    now = iso8601_now()
    return {
        "anomaly_id": f"anomaly-sim-{uuid.uuid4().hex[:8]}",
        "x": x,
        "y": y,
        "frame_id": "map",
        "status": "detected",
        "detected_at": now,
        "updated_at": now,
        "source_device_id": source_device_id,
        "description": f"Simulated anomaly detection (confidence={confidence:.2f})",
        "confidence": confidence,
    }


def wait_for_device(
    tracker: IotPositionTracker, timeout_sec: float, poll_interval_sec: float = 0.2
) -> tuple[str, float, float] | None:
    """Polls tracker.random_device() until one is seen or timeout_sec elapses."""
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        device = tracker.random_device()
        if device is not None:
            return device
        time.sleep(poll_interval_sec)
    return tracker.random_device()  # one last try right at the deadline


def publish_one_anomaly(session: "zenoh.Session", device: tuple[str, float, float], args: argparse.Namespace) -> dict:
    device_id, base_x, base_y = device
    dx, dy = random_offset(args.radius_m)
    confidence = random.uniform(args.min_confidence, args.max_confidence)
    payload = build_anomaly_payload(device_id, base_x + dx, base_y + dy, confidence)
    session.put(anomaly_key(payload["anomaly_id"]), json.dumps(payload).encode("utf-8"))
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--zenoh-router", default="tcp/localhost:7447")
    parser.add_argument("--radius-m", type=float, default=3.0, help="Max distance from the IoT device")
    parser.add_argument("--min-interval-sec", type=float, default=15.0)
    parser.add_argument("--max-interval-sec", type=float, default=45.0)
    parser.add_argument("--min-confidence", type=float, default=0.6)
    parser.add_argument("--max-confidence", type=float, default=0.99)
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Run as a continuous background demo (a new anomaly every --min/max-interval-sec, "
        "forever) instead of the default: publish exactly one anomaly near a randomly-chosen "
        "IoT device, then exit.",
    )
    parser.add_argument(
        "--wait-timeout-sec",
        type=float,
        default=10.0,
        help="Single-shot mode only (the default, i.e. without --loop): how long to wait for at "
        "least one IoT device position before giving up.",
    )
    args = parser.parse_args()

    config = zenoh.Config()
    config.insert_json5("mode", json.dumps("client"))
    config.insert_json5("connect/endpoints", json.dumps([args.zenoh_router]))
    session = zenoh.open(config)

    tracker = IotPositionTracker()
    session.declare_subscriber(DEVICE_STATE_KEY, tracker.on_sample)
    print(f"[anomaly_simulator] connected to {args.zenoh_router}, watching {DEVICE_STATE_KEY}")

    if not args.loop:
        try:
            device = wait_for_device(tracker, args.wait_timeout_sec)
            if device is None:
                print(f"[anomaly_simulator] no IoT devices seen within {args.wait_timeout_sec:.0f}s, giving up")
                raise SystemExit(1)
            payload = publish_one_anomaly(session, device, args)
            print(
                f"[anomaly_simulator] published {payload['anomaly_id']} near {device[0]} "
                f"at ({payload['x']:.2f}, {payload['y']:.2f}) confidence={payload['confidence']:.2f}"
            )
            print(payload["anomaly_id"])
        finally:
            session.close()
        return

    try:
        while True:
            time.sleep(random.uniform(args.min_interval_sec, args.max_interval_sec))

            device = tracker.random_device()
            if device is None:
                print("[anomaly_simulator] no IoT devices seen yet, skipping this round")
                continue

            payload = publish_one_anomaly(session, device, args)
            print(
                f"[anomaly_simulator] published {payload['anomaly_id']} near {device[0]} "
                f"at ({payload['x']:.2f}, {payload['y']:.2f}) confidence={payload['confidence']:.2f}"
            )
    except KeyboardInterrupt:
        pass
    finally:
        session.close()


if __name__ == "__main__":
    main()
