import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

import yaml

from core.errors import (
    MissionAlreadyExistsError,
    MissionNotFoundError,
    MissionValidationError,
)
from models.mission import Mission, MissionSummary

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _parse_hhmm(value: str) -> int:
    hh, mm = value.split(":")
    return int(hh) * 60 + int(mm)


def _time_in_slot(now_minutes: int, start_minutes: int, end_minutes: int) -> bool:
    if start_minutes <= end_minutes:
        return start_minutes <= now_minutes < end_minutes
    # Overnight slot, e.g. 22:00-06:00.
    return now_minutes >= start_minutes or now_minutes < end_minutes


def _atomic_write_yaml(path: Path, data: dict) -> None:
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


class MissionServer:
    def __init__(self, mission_folder: str, app_state_path: str) -> None:
        self._mission_folder = Path(mission_folder)
        self._app_state_path = Path(app_state_path)

        self._lock = threading.RLock()
        self._missions: dict[str, Mission] = {}
        self._current_id: str | None = None
        self._default_id: str | None = None

    def load(self) -> None:
        with self._lock:
            self._mission_folder.mkdir(parents=True, exist_ok=True)
            self._app_state_path.parent.mkdir(parents=True, exist_ok=True)

            missions: dict[str, Mission] = {}
            for path in sorted(self._mission_folder.glob("*.yaml")):
                with open(path, "r", encoding="utf-8") as f:
                    raw = yaml.safe_load(f)
                if raw is None:
                    raise MissionValidationError(
                        f"Mission file is empty or invalid: {path}"
                    )
                try:
                    mission = Mission(**raw)
                except Exception as exc:
                    raise MissionValidationError(
                        f"Invalid mission file {path}: {exc}"
                    ) from exc
                missions[mission.mission_id] = mission
            self._missions = missions

            current_id: str | None = None
            default_id: str | None = None
            if self._app_state_path.exists():
                with open(self._app_state_path, "r", encoding="utf-8") as f:
                    state = yaml.safe_load(f) or {}
                current_id = state.get("current_mission_id")
                default_id = state.get("default_mission_id")

            corrected = False
            if current_id is not None and current_id not in self._missions:
                current_id = None
                corrected = True
            if default_id is not None and default_id not in self._missions:
                default_id = None
                corrected = True

            self._current_id = current_id
            self._default_id = default_id

            if corrected or not self._app_state_path.exists():
                self._persist_app_state()

    def _persist_app_state(self) -> None:
        _atomic_write_yaml(
            self._app_state_path,
            {
                "current_mission_id": self._current_id,
                "default_mission_id": self._default_id,
            },
        )

    def _mission_path(self, mission_id: str) -> Path:
        return self._mission_folder / f"{mission_id}.yaml"

    def _persist_mission(self, mission: Mission) -> None:
        _atomic_write_yaml(self._mission_path(mission.mission_id), mission.model_dump(mode="json"))

    def list_missions(self) -> list[MissionSummary]:
        with self._lock:
            summaries = [
                MissionSummary(
                    mission_id=m.mission_id,
                    name=m.name,
                    map_name=m.map_name,
                    frame_id=m.frame_id,
                    waypoint_count=len(m.waypoints),
                    time_slot=m.time_slot,
                    is_current=(m.mission_id == self._current_id),
                    is_default=(m.mission_id == self._default_id),
                    updated_at=m.updated_at,
                )
                for m in self._missions.values()
            ]
            return sorted(summaries, key=lambda s: s.mission_id)

    def get_mission(self, mission_id: str) -> Mission | None:
        with self._lock:
            mission = self._missions.get(mission_id)
            return mission.model_copy(deep=True) if mission else None

    def get_current(self) -> Mission | None:
        with self._lock:
            if self._current_id is None:
                return None
            return self.get_mission(self._current_id)

    def get_default(self) -> Mission | None:
        with self._lock:
            if self._default_id is None:
                return None
            return self.get_mission(self._default_id)

    def create_mission(self, mission: Mission) -> Mission:
        with self._lock:
            if mission.mission_id in self._missions:
                raise MissionAlreadyExistsError(
                    f"Mission already exists: {mission.mission_id}"
                )
            now = datetime.now(timezone.utc)
            stored = mission.model_copy(update={"created_at": now, "updated_at": now})
            self._persist_mission(stored)
            self._missions[stored.mission_id] = stored
            return stored.model_copy(deep=True)

    def update_mission(self, mission_id: str, mission: Mission) -> Mission:
        with self._lock:
            existing = self._missions.get(mission_id)
            if existing is None:
                raise MissionNotFoundError(f"Mission not found: {mission_id}")
            if mission.mission_id != mission_id:
                raise MissionValidationError(
                    "Body mission_id must match the path mission_id"
                )
            now = datetime.now(timezone.utc)
            stored = mission.model_copy(
                update={"created_at": existing.created_at, "updated_at": now}
            )
            self._persist_mission(stored)
            self._missions[mission_id] = stored
            return stored.model_copy(deep=True)

    def delete_mission(self, mission_id: str) -> None:
        with self._lock:
            if mission_id not in self._missions:
                raise MissionNotFoundError(f"Mission not found: {mission_id}")
            del self._missions[mission_id]
            path = self._mission_path(mission_id)
            if path.exists():
                path.unlink()

            changed = False
            if self._current_id == mission_id:
                self._current_id = None
                changed = True
            if self._default_id == mission_id:
                self._default_id = None
                changed = True
            if changed:
                self._persist_app_state()

    def activate(self, mission_id: str) -> Mission:
        with self._lock:
            if mission_id not in self._missions:
                raise MissionNotFoundError(f"Mission not found: {mission_id}")
            self._current_id = mission_id
            self._persist_app_state()
            return self.get_mission(mission_id)

    def set_default(self, mission_id: str) -> Mission:
        with self._lock:
            if mission_id not in self._missions:
                raise MissionNotFoundError(f"Mission not found: {mission_id}")
            self._default_id = mission_id
            self._persist_app_state()
            return self.get_mission(mission_id)

    def resolve_by_time(self, time_str: str) -> Mission | None:
        if not _HHMM_RE.match(time_str):
            raise MissionValidationError(f"Invalid HH:MM time: {time_str!r}")
        now_minutes = _parse_hhmm(time_str)

        with self._lock:
            matches = []
            for mission in self._missions.values():
                slot = mission.time_slot
                if slot is None or slot.start is None or slot.end is None:
                    continue
                if _time_in_slot(
                    now_minutes, _parse_hhmm(slot.start), _parse_hhmm(slot.end)
                ):
                    matches.append(mission)

            if not matches:
                return None
            matches.sort(key=lambda m: m.mission_id)
            return matches[0].model_copy(deep=True)
