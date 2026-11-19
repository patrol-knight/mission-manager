import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Run:
    path: Path
    meta: dict
    end: dict
    t0: float
    rows: dict[str, list[dict]] = field(default_factory=dict)

    def __getitem__(self, kind: str) -> list[dict]:
        return self.rows.get(kind, [])

    @property
    def results(self) -> Path:
        return self.path / "results"

    @property
    def duration_s(self) -> float:
        times = [r["t"] for rows in self.rows.values() for r in rows]
        return max(times) - self.t0 if times else 0.0

    def devices(self) -> list[str]:
        ids = {r["device_id"] for kind in ("window", "ping", "link", "video") for r in self[kind]}
        return sorted(ids)

    def of(self, kind: str, device: str) -> list[dict]:
        return [r for r in self[kind] if r.get("device_id") == device]


def load_run(path: Path) -> Run:
    """A run folder (data/runs/<run>) or its record.jsonl."""
    record = path if path.is_file() else path / "record.jsonl"
    rows: dict[str, list[dict]] = {}
    for line in record.read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            rows.setdefault(row.pop("type"), []).append(row)
    meta = (rows.pop("meta", None) or [{}])[0]
    end = (rows.pop("end", None) or [{}])[0]
    return Run(record.parent, meta, end, meta.get("t", 0.0), rows)
