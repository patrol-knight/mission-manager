import json
import os
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import IO


class RunRecorder:
    """Writes one run to runs_dir/<YYYYMMDD_HHMMSS>/record.jsonl: a "meta"
    line, then one line per measurement ({"type": ..., "t": ...}), then
    "end". As root (Docker), everything it creates, data/ included, is
    chowned to `owner` ("uid:gid") so the host user can read it and the
    analyzer can write results/ next to it."""

    def __init__(self, runs_dir: str, owner: str | None = None) -> None:
        self._runs_dir = Path(runs_dir)
        self._owner = tuple(int(v) for v in owner.split(":")) if owner and os.geteuid() == 0 else None
        self._lock = threading.Lock()
        self._run: Path | None = None
        self._file: IO[str] | None = None
        self._started_at: str | None = None

    @property
    def run_id(self) -> str | None:
        return self._run.name if self._run else None

    @property
    def started_at(self) -> str | None:
        return self._started_at

    def start(self, meta: dict) -> str:
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
            path = run / "record.jsonl"
            self._file = path.open("w", encoding="utf-8")
            self._chown(path)
            self._run = run
            self._started_at = now.isoformat()
            self._line({"type": "meta", "t": time.time(), "started_at": self._started_at} | meta)
            return run.name

    def write(self, kind: str, rows: list[dict]) -> None:
        with self._lock:
            if self._file is None:
                return
            for row in rows:
                self._line({"type": kind} | row)

    def stop(self, meta: dict) -> str | None:
        with self._lock:
            if self._run is None:
                return None
            self._line({"type": "end", "t": time.time()} | meta)
            self._file.close()
            run_id = self._run.name
            self._run = self._file = self._started_at = None
            return run_id

    def _line(self, row: dict) -> None:
        clean = {k: round(v, 4) if isinstance(v, float) else v for k, v in row.items() if v is not None}
        self._file.write(json.dumps(clean, separators=(",", ":")) + "\n")
        self._file.flush()

    def _chown(self, path: Path) -> None:
        if self._owner:
            os.chown(path, *self._owner)
