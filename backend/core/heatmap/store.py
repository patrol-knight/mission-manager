import hashlib
import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import yaml
from pydantic import ValidationError

from core.heatmap.simulator import VERSION
from models.heatmap import BaselineSpec, HeatEvent, HeatmapConfig, RealEvent

logger = logging.getLogger(__name__)

FILES = ("config.yaml", "baseline.yaml", "baseline.jsonl", "real.jsonl")


def spec_hash(spec: BaselineSpec) -> str:
    return hashlib.sha256(json.dumps(spec.model_dump(), sort_keys=True).encode()).hexdigest()[:12]


class HeatmapStore:
    """One map's heatmap files under storage/heatmap/<map>/. config.yaml,
    baseline.yaml and baseline.jsonl are tracked in git; real.jsonl is not."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self._real_ids: set[str] | None = None

    def stamp(self) -> tuple:
        return tuple(
            (s.st_mtime_ns, s.st_size) if (p := self.root / name).exists() and (s := p.stat()) else None
            for name in FILES
        )

    def config(self) -> HeatmapConfig:
        data = self._read_yaml("config.yaml")
        return HeatmapConfig.model_validate(data) if data is not None else HeatmapConfig()

    def save_config(self, config: HeatmapConfig) -> None:
        self._write("config.yaml", _yaml("Heatmap weights and scale; see backend/core/heatmap/README.md", config))

    def spec(self) -> BaselineSpec | None:
        data = self._read_yaml("baseline.yaml")
        return BaselineSpec.model_validate(data) if data is not None else None

    def baseline(self) -> tuple[dict, list[HeatEvent]]:
        """(meta, events) from baseline.jsonl; its first line is the meta."""
        lines = self._read_lines("baseline.jsonl")
        if not lines:
            return {}, []
        meta = json.loads(lines[0]).get("meta", {})
        return meta, _parse(HeatEvent, lines[1:], "baseline.jsonl")

    def save_baseline(self, spec: BaselineSpec, events: list[HeatEvent], merged_real: int = 0) -> dict:
        meta = {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "simulator": VERSION,
            "spec_hash": spec_hash(spec),
            "events": len(events),
            "merged_real": merged_real,
        }
        lines = [json.dumps({"meta": meta})] + [json.dumps(e.model_dump()) for e in events]
        with self._lock:
            self._write("baseline.yaml", _yaml("Dummy history the simulator generates baseline.jsonl from", spec))
            self._write("baseline.jsonl", "\n".join(lines) + "\n")
        return meta

    def real(self) -> list[RealEvent]:
        return _parse(RealEvent, self._read_lines("real.jsonl"), "real.jsonl")

    def append_real(self, event: RealEvent) -> bool:
        """False when that anomaly id is already recorded."""
        with self._lock:
            if self._real_ids is None:
                self._real_ids = {e.id for e in self.real()}
            if event.id in self._real_ids:
                return False
            self.root.mkdir(parents=True, exist_ok=True)
            with (self.root / "real.jsonl").open("a", encoding="utf-8") as f:
                f.write(event.model_dump_json() + "\n")
            self._real_ids.add(event.id)
            return True

    def clear_real(self) -> int:
        with self._lock:
            count = len(self.real())
            (self.root / "real.jsonl").unlink(missing_ok=True)
            self._real_ids = set()
            return count

    def _read_yaml(self, name: str):
        path = self.root / name
        return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else None

    def _read_lines(self, name: str) -> list[str]:
        path = self.root / name
        if not path.exists():
            return []
        return [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def _write(self, name: str, text: str) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / f".{name}.tmp"
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, self.root / name)


def _yaml(header: str, model) -> str:
    return f"# {header}\n" + yaml.safe_dump(model.model_dump(mode="json"), sort_keys=False, allow_unicode=True)


def _parse(model, lines: list[str], name: str) -> list:
    events = []
    for number, line in enumerate(lines, 1):
        try:
            events.append(model.model_validate_json(line))
        except ValidationError:
            logger.warning("%s: skipping malformed line %d", name, number)
    return events
