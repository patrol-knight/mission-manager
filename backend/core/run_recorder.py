import csv
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import IO

import yaml

TABLES = {
    "windows": [
        "t", "device_id", "stream", "window_s", "count", "rate_hz", "expected_hz", "kbps", "payload_kb_mean",
        "payload_kb_max", "interval_ms_mean", "jitter_ms", "interval_ms_max", "latency_ms_p50",
        "latency_ms_max", "gaps", "gap_ms_max", "silent_s",
    ],
    "samples": ["t", "device_id", "stream", "bytes", "payload_ts", "latency_ms"],
    "ping": ["t", "device_id", "ip", "rtt_ms", "lost"],
    "links": ["t", "device_id", "ip", "zenoh_connected", "zenoh_session", "reconnects"],
    "robot": ["t", "device_id", "x", "y", "yaw", "lat", "lon", "connected"],
    "webrtc": [
        "t", "device_id", "state", "bitrate_kbps", "fps", "width", "height", "packets_received", "packets_lost",
        "loss_pct", "jitter_ms", "rtt_ms", "frames_decoded", "frames_dropped", "freeze_count", "freeze_s",
        "nack_count", "pli_count", "jitter_buffer_ms", "available_kbps", "local_candidate", "remote_candidate",
    ],
    "ws": ["t", "rtt_ms"],
}


class RunRecorder:
    """Writes one run to runs_dir/<YYYYMMDD_HHMMSS>/: metadata.yaml plus one
    CSV per table. As root (Docker), everything it creates, data/ included,
    is chowned to `owner` ("uid:gid"), so the host user can read and write it."""

    def __init__(self, runs_dir: str, owner: str | None = None) -> None:
        self._runs_dir = Path(runs_dir)
        self._owner = tuple(int(v) for v in owner.split(":")) if owner and os.geteuid() == 0 else None
        self._lock = threading.Lock()
        self._run: Path | None = None
        self._meta: dict = {}
        self._files: dict[str, IO[str]] = {}
        self._writers: dict[str, csv.DictWriter] = {}

    @property
    def run_id(self) -> str | None:
        return self._run.name if self._run else None

    @property
    def started_at(self) -> str | None:
        return self._meta.get("started_at") if self._run else None

    def _chown(self, path: Path) -> None:
        if self._owner:
            os.chown(path, *self._owner)

    def start(self, label: str, notes: str, extra: dict) -> str:
        with self._lock:
            if self._run is not None:
                raise RuntimeError("already recording")
            self._runs_dir.mkdir(parents=True, exist_ok=True)
            self._chown(self._runs_dir.parent)
            self._chown(self._runs_dir)
            now = datetime.now().astimezone()
            run = self._runs_dir / now.strftime("%Y%m%d_%H%M%S")
            run.mkdir()
            self._chown(run)
            self._run = run
            self._meta = {"label": label, "notes": notes, "started_at": now.isoformat(), "ended_at": None} | extra
            self._write_meta()
            for name, fields in TABLES.items():
                path = run / f"{name}.csv"
                f = path.open("w", newline="")
                self._chown(path)
                writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                writer.writeheader()
                self._files[name] = f
                self._writers[name] = writer
            return run.name

    def write(self, table: str, rows: list[dict]) -> None:
        with self._lock:
            writer = self._writers.get(table)
            if writer is None or not rows:
                return
            writer.writerows({k: round(v, 4) if isinstance(v, float) else v for k, v in row.items()} for row in rows)
            self._files[table].flush()

    def update_meta(self, fields: dict) -> None:
        with self._lock:
            if self._run is not None:
                self._meta |= fields
                self._write_meta()

    def stop(self) -> str | None:
        with self._lock:
            if self._run is None:
                return None
            for f in self._files.values():
                f.close()
            self._files.clear()
            self._writers.clear()
            self._meta["ended_at"] = datetime.now().astimezone().isoformat()
            self._write_meta()
            run_id = self._run.name
            self._run = None
            return run_id

    def _write_meta(self) -> None:
        path = self._run / "metadata.yaml"
        path.write_text(yaml.safe_dump(self._meta, sort_keys=False, allow_unicode=True))
        self._chown(path)

    def list_runs(self) -> list[dict]:
        if not self._runs_dir.is_dir():
            return []
        runs = []
        for run in sorted(self._runs_dir.iterdir(), reverse=True):
            meta_path = run / "metadata.yaml"
            if not meta_path.is_file():
                continue
            try:
                meta = yaml.safe_load(meta_path.read_text()) or {}
            except yaml.YAMLError:
                meta = {}
            runs.append({
                "run_id": run.name,
                "label": meta.get("label", ""),
                "started_at": meta.get("started_at"),
                "ended_at": meta.get("ended_at"),
            })
        return runs
