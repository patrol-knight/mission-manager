import csv
from dataclasses import dataclass, field
from pathlib import Path

import yaml


def _value(text: str):
    if text == "":
        return None
    if text in ("True", "False"):
        return text == "True"
    try:
        return float(text)
    except ValueError:
        return text


def read_table(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    with path.open(newline="") as f:
        return [{k: _value(v) for k, v in row.items()} for row in csv.DictReader(f)]


@dataclass
class Run:
    path: Path
    meta: dict
    t0: float
    tables: dict[str, list[dict]] = field(default_factory=dict)

    def __getitem__(self, name: str) -> list[dict]:
        return self.tables.get(name, [])

    def devices(self) -> list[str]:
        ids = {r["device_id"] for name in ("windows", "ping", "links") for r in self[name]}
        return sorted(str(i) for i in ids)


def load_run(path: Path) -> Run:
    meta = yaml.safe_load((path / "metadata.yaml").read_text()) or {}
    tables = {p.stem: read_table(p) for p in path.glob("*.csv") if p.stem != "summary"}
    times = [r["t"] for rows in tables.values() for r in rows if isinstance(r.get("t"), float)]
    return Run(path, meta, min(times) if times else 0.0, tables)
