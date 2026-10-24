import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

import yaml

from core.errors import (
    MissionAlreadyExistsError,
    MissionNotFoundError,
    MissionValidationError,
)
from core.map_server import MapServer
from models.mission import Mission, MissionSummary

logger = logging.getLogger(__name__)

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
        # mission_id -> (updated_at, loop distance)
        self._distance_cache: dict[str, tuple[datetime | None, float | None]] = {}

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
            if self._app_state_path.exists():
                with open(self._app_state_path, "r", encoding="utf-8") as f:
                    state = yaml.safe_load(f) or {}
                current_id = state.get("current_mission_id")
                # Rewrite files still carrying the removed default_mission_id.
                corrected = "default_mission_id" in state
            else:
                corrected = False

            if current_id is not None and current_id not in self._missions:
                current_id = None
                corrected = True

            self._current_id = current_id

            if corrected or not self._app_state_path.exists():
                self._persist_app_state()

    def _persist_app_state(self) -> None:
        _atomic_write_yaml(
            self._app_state_path,
            {"current_mission_id": self._current_id},
        )

    def _mission_path(self, mission_id: str) -> Path:
        return self._mission_folder / f"{mission_id}.yaml"

    def _persist_mission(self, mission: Mission) -> None:
        _atomic_write_yaml(self._mission_path(mission.mission_id), mission.model_dump(mode="json"))

    def _loop_distance_m(self, mission: Mission, map_server: MapServer) -> float | None:
        if len(mission.waypoints) < 2:
            return None
        looped = list(mission.waypoints) + [mission.waypoints[0]]
        try:
            route = map_server.get_route([{"x": wp.x, "y": wp.y} for wp in looped])
        except Exception:
            logger.warning(
                "Failed to compute route distance for mission %s", mission.mission_id, exc_info=True
            )
            return None
        if route is None:
            return None
        return route["properties"]["length_m"]

    def _cached_loop_distance_m(self, mission: Mission, map_server: MapServer | None) -> float | None:
        if map_server is None or not map_server.is_available():
            return None
        cached = self._distance_cache.get(mission.mission_id)
        if cached is not None and cached[0] == mission.updated_at:
            return cached[1]
        distance_m = self._loop_distance_m(mission, map_server)
        self._distance_cache[mission.mission_id] = (mission.updated_at, distance_m)
        return distance_m

    def list_missions(self, map_server: MapServer | None = None) -> list[MissionSummary]:
        # Route outside the lock; a cold cache routes every mission.
        with self._lock:
            missions = list(self._missions.values())
            current_id = self._current_id

        summaries = []
        for m in missions:
            home_x = m.waypoints[0].x if m.waypoints else None
            home_y = m.waypoints[0].y if m.waypoints else None
            distance_m = self._cached_loop_distance_m(m, map_server)
            summaries.append(
                MissionSummary(
                    mission_id=m.mission_id,
                    name=m.name,
                    map_name=m.map_name,
                    frame_id=m.frame_id,
                    waypoint_count=len(m.waypoints),
                    loop_count=m.loop_count,
                    infinite_loop=m.infinite_loop,
                    home_x=home_x,
                    home_y=home_y,
                    distance_m=distance_m,
                    is_current=(m.mission_id == current_id),
                    updated_at=m.updated_at,
                )
            )
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
            self._distance_cache.pop(mission_id, None)
            path = self._mission_path(mission_id)
            if path.exists():
                path.unlink()

            if self._current_id == mission_id:
                self._current_id = None
                self._persist_app_state()

    def activate(self, mission_id: str) -> Mission:
        with self._lock:
            if mission_id not in self._missions:
                raise MissionNotFoundError(f"Mission not found: {mission_id}")
            self._current_id = mission_id
            self._persist_app_state()
            return self.get_mission(mission_id)
