import json
import statistics
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime

# Streams published on a fixed period; only these count gaps.
PERIODIC_STREAMS = {"state", "health", "skeleton", "camera_state"}
GAP_FACTOR = 3.0
GAP_FLOOR_SEC = 0.5
INTERVAL_HISTORY = 50


def classify_key(key: str) -> tuple[str, str] | None:
    """Zenoh key -> (device_id, stream), e.g. devices/iot-01/cameras/front/state
    -> ("iot-01", "camera_state")."""
    parts = key.split("/")
    if len(parts) >= 3 and parts[0] == "devices":
        if parts[2] == "cameras" and len(parts) >= 5:
            return parts[1], "camera_" + "_".join(parts[4:]).replace("-", "_")
        return parts[1], "_".join(parts[2:])
    if len(parts) >= 3 and parts[0] == "anomalies":
        return "anomalies", parts[2]
    return None


def payload_timestamp(payload: bytes) -> float | None:
    """Epoch seconds from the payload's `timestamp` (float or ISO 8601)."""
    try:
        value = json.loads(payload).get("timestamp")
    except (ValueError, AttributeError):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


@dataclass
class Sample:
    t: float
    device_id: str
    stream: str
    size: int
    payload_ts: float | None
    # Monotonic arrival time: intervals must not jump with wall-clock corrections.
    mono: float = 0.0

    @property
    def latency_ms(self) -> float | None:
        return (self.t - self.payload_ts) * 1000 if self.payload_ts is not None else None


class _Stream:
    def __init__(self, periodic: bool) -> None:
        self.periodic = periodic
        self.last_arrival: float | None = None
        self.intervals: deque[float] = deque(maxlen=INTERVAL_HISTORY)
        self.total_gaps = 0
        self._reset()

    def _reset(self) -> None:
        self.count = 0
        self.bytes = 0
        self.size_max = 0
        self.window_intervals: list[float] = []
        self.latencies: list[float] = []
        self.gaps = 0
        self.gap_max = 0.0

    def gap_threshold(self) -> float | None:
        if not self.periodic or len(self.intervals) < 5:
            return None
        return max(GAP_FACTOR * statistics.median(self.intervals), GAP_FLOOR_SEC)

    def add(self, sample: Sample) -> None:
        if self.last_arrival is not None:
            dt = sample.mono - self.last_arrival
            threshold = self.gap_threshold()
            if threshold is not None and dt > threshold:
                self.gaps += 1
                self.total_gaps += 1
                self.gap_max = max(self.gap_max, dt)
            self.intervals.append(dt)
            self.window_intervals.append(dt)
        self.last_arrival = sample.mono
        self.count += 1
        self.bytes += sample.size
        self.size_max = max(self.size_max, sample.size)
        if sample.latency_ms is not None:
            self.latencies.append(sample.latency_ms)

    def window(self, now: float, window_sec: float) -> dict:
        intervals = self.window_intervals
        median = statistics.median(self.intervals) if self.intervals else None
        row = {
            "window_s": window_sec,
            "count": self.count,
            "rate_hz": self.count / window_sec,
            "expected_hz": 1 / median if self.periodic and median else None,
            "kbps": self.bytes * 8 / 1000 / window_sec,
            "payload_kb_mean": self.bytes / self.count / 1000 if self.count else None,
            "payload_kb_max": self.size_max / 1000 if self.count else None,
            "interval_ms_mean": statistics.fmean(intervals) * 1000 if intervals else None,
            "jitter_ms": statistics.pstdev(intervals) * 1000 if len(intervals) >= 2 else None,
            "interval_ms_max": max(intervals) * 1000 if intervals else None,
            "latency_ms_p50": statistics.median(self.latencies) if self.latencies else None,
            "latency_ms_max": max(self.latencies) if self.latencies else None,
            "gaps": self.gaps,
            "gap_ms_max": self.gap_max * 1000 if self.gaps else None,
            "total_gaps": self.total_gaps,
            "silent_s": now - self.last_arrival if self.last_arrival is not None else None,
        }
        self._reset()
        return row


class NetStats:
    """Per (device, stream) counters fed from Zenoh's thread, drained once
    per window by the devtools loop."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._streams: dict[tuple[str, str], _Stream] = {}
        self._samples: list[Sample] = []
        self.keep_samples = False

    def add(self, sample: Sample) -> None:
        with self._lock:
            key = (sample.device_id, sample.stream)
            stream = self._streams.get(key)
            if stream is None:
                stream = self._streams[key] = _Stream(sample.stream in PERIODIC_STREAMS)
            stream.add(sample)
            if self.keep_samples:
                self._samples.append(sample)

    def collect(self, now: float, window_sec: float) -> tuple[list[dict], list[Sample]]:
        with self._lock:
            rows = [
                {"device_id": device_id, "stream": name} | stream.window(now, window_sec)
                for (device_id, name), stream in sorted(self._streams.items())
            ]
            samples, self._samples = self._samples, []
        return rows, samples

    def reset(self) -> None:
        with self._lock:
            self._streams.clear()
            self._samples = []
