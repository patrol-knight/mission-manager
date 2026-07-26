import logging
import math
import random
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

from config import Settings
from core.anomaly_registry import AnomalyRegistry
from core.device_registry import DeviceRegistry
from core.errors import DeviceTypeMismatchError
from core.mission_execution import MissionExecutionManager
from core.mission_server import MissionServer
from core.websocket_manager import WebSocketManager
from models.anomaly import Anomaly, AnomalyStatus
from models.device import DeviceFixture, DeviceFixtureFile, DeviceState, DeviceType, Pose2D
from models.mission_execution import MissionStatus

logger = logging.getLogger(__name__)


def _load_device_fixtures(path: str) -> list[DeviceFixture]:
    """Loads simulation/fixtures/devices.yaml. This is a dev-convenience file,
    not core app data like missions — a missing or malformed file logs a
    warning and falls back to an empty list (callers then use their own
    hardcoded/config-driven defaults) rather than crashing startup."""
    file_path = Path(path)
    if not file_path.exists():
        return []
    try:
        raw = yaml.safe_load(file_path.read_text(encoding="utf-8")) or {}
        return DeviceFixtureFile(**raw).devices
    except Exception:
        logger.warning("Failed to load device fixtures from %s; using defaults", path, exc_info=True)
        return []


def _publish_device_state(
    state: DeviceState,
    device_registry: DeviceRegistry,
    websocket_manager: WebSocketManager,
) -> None:
    """Upsert + conditionally broadcast device.updated. Deliberately duplicated
    (not shared) from transport/zenoh_gateway.py's ingest tail — this file is
    dev-only and must stay fully decoupled from the real transport path."""
    try:
        changed = device_registry.upsert(state, received_at=time.time())
    except DeviceTypeMismatchError:
        logger.warning("Simulator: device type mismatch for %s, dropping update", state.device_id)
        return
    if changed:
        view = device_registry.get(state.device_id)
        if view is not None:
            websocket_manager.broadcast_threadsafe(
                {"type": "device.updated", "data": view.model_dump(mode="json")}
            )


class DevSimulator:
    """Dev-only, disabled-by-default data producer so the frontend can be
    developed/demoed without real robots or Zenoh. Moves a virtual robot along
    the current mission's waypoints, publishes a few virtual IoT devices with
    occasional connectivity flapping, and periodically spawns one anomaly the
    robot detours to. Everything here is a demo convenience — it is not a
    production scheduler/anomaly-response contract."""

    def __init__(
        self,
        settings: Settings,
        mission_server: MissionServer,
        mission_execution_manager: MissionExecutionManager,
        device_registry: DeviceRegistry,
        anomaly_registry: AnomalyRegistry,
        websocket_manager: WebSocketManager,
    ) -> None:
        self._settings = settings
        self._mission_server = mission_server
        self._mission_execution = mission_execution_manager
        self._device_registry = device_registry
        self._anomaly_registry = anomaly_registry
        self._websocket_manager = websocket_manager

        fixtures = _load_device_fixtures(settings.simulator_fixtures_path)
        robot_fixture = next(
            (f for f in fixtures if f.type == DeviceType.ROBOT and f.device_id == settings.simulator_robot_device_id),
            None,
        )
        iot_fixtures = [f for f in fixtures if f.type == DeviceType.IOT]

        self._robot_id = settings.simulator_robot_device_id
        self._robot_enabled = robot_fixture.enabled if robot_fixture is not None else True
        if robot_fixture is not None:
            self._robot_pose = Pose2D(frame_id="map", x=robot_fixture.x, y=robot_fixture.y, yaw=robot_fixture.yaw)
        else:
            self._robot_pose = Pose2D(frame_id="map", x=0.0, y=0.0, yaw=0.0)
        self._detour_target: tuple[float, float] | None = None
        self._active_anomaly_id: str | None = None

        if iot_fixtures:
            self._iot_anchors: dict[str, tuple[float, float]] = {
                f.device_id: (f.x, f.y) for f in iot_fixtures if f.enabled
            }
        else:
            self._iot_anchors = {iot_id: (0.0, 0.0) for iot_id in settings.simulator_iot_device_ids}

        now = time.time()
        self._iot_flap_until: dict[str, float] = {}
        self._iot_next_flap_at: dict[str, float] = {
            iot_id: now + random.uniform(settings.simulator_iot_flap_min_sec, settings.simulator_iot_flap_max_sec)
            for iot_id in self._iot_anchors
        }
        self._next_anomaly_at = now + random.uniform(
            settings.simulator_anomaly_min_interval_sec, settings.simulator_anomaly_max_interval_sec
        )

    def tick(self) -> None:
        now = time.time()
        self._tick_robot(now)
        self._tick_iot(now)
        self._tick_anomaly(now)

    # ---- robot ----

    def _publish_robot(self, now: float, speed: float) -> None:
        _publish_device_state(
            DeviceState(
                device_id=self._robot_id,
                name="Simulated Robot",
                type=DeviceType.ROBOT,
                pose=self._robot_pose,
                timestamp=now,
                battery=95.0,
                speed=speed,
                status={},
                capabilities=["camera"],
            ),
            self._device_registry,
            self._websocket_manager,
        )

    def _tick_robot(self, now: float) -> None:
        if not self._robot_enabled:
            return

        # Publish the robot's current pose every tick regardless of mission
        # state — a real Zenoh-connected robot reports its position whether
        # idle/docked or mid-mission, so the simulator should too. Only the
        # "step toward a target waypoint" logic below is gated on the mission
        # actually running.
        execution = self._mission_execution.get_state()
        if execution is None or execution.status not in (
            MissionStatus.RUNNING,
            MissionStatus.RETURNING_HOME,
        ):
            self._publish_robot(now, speed=0.0)
            return

        mission = self._mission_server.get_mission(execution.mission_id)
        if mission is None or not mission.waypoints:
            self._publish_robot(now, speed=0.0)
            return

        target_index: int | None
        if self._detour_target is not None:
            target_x, target_y = self._detour_target
            target_index = None
        elif execution.status == MissionStatus.RETURNING_HOME:
            home = mission.waypoints[0]
            target_x, target_y = home.x, home.y
            target_index = 0
        else:
            target_index = (execution.current_waypoint_index + 1) % len(mission.waypoints)
            target_wp = mission.waypoints[target_index]
            target_x, target_y = target_wp.x, target_wp.y

        arrived = self._step_robot_towards(target_x, target_y)
        self._publish_robot(now, speed=0.0 if arrived else self._settings.simulator_robot_speed_mps)

        if not arrived:
            return

        if self._detour_target is not None:
            self._detour_target = None
            if self._active_anomaly_id is not None:
                updated = self._anomaly_registry.update_status(
                    self._active_anomaly_id, AnomalyStatus.ROBOT_ARRIVED
                )
                self._websocket_manager.broadcast_threadsafe(
                    {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
                )
            return

        assert target_index is not None
        self._mission_execution.record_waypoint_reached(target_index)

    def _step_robot_towards(self, target_x: float, target_y: float) -> bool:
        dx = target_x - self._robot_pose.x
        dy = target_y - self._robot_pose.y
        dist = math.hypot(dx, dy)
        max_step = self._settings.simulator_robot_speed_mps * self._settings.simulator_tick_interval_sec

        if dist <= max_step:
            yaw = math.atan2(dy, dx) if dist > 1e-6 else self._robot_pose.yaw
            self._robot_pose = Pose2D(frame_id="map", x=target_x, y=target_y, yaw=yaw)
            return True

        yaw = math.atan2(dy, dx)
        new_x = self._robot_pose.x + (dx / dist) * max_step
        new_y = self._robot_pose.y + (dy / dist) * max_step
        self._robot_pose = Pose2D(frame_id="map", x=new_x, y=new_y, yaw=yaw)
        return False

    # ---- iot ----

    def _tick_iot(self, now: float) -> None:
        for iot_id, (anchor_x, anchor_y) in self._iot_anchors.items():
            flap_until = self._iot_flap_until.get(iot_id)
            if flap_until is not None:
                if now < flap_until:
                    continue  # withhold updates — the existing offline-timeout monitor marks it disconnected
                del self._iot_flap_until[iot_id]
                self._iot_next_flap_at[iot_id] = now + random.uniform(
                    self._settings.simulator_iot_flap_min_sec, self._settings.simulator_iot_flap_max_sec
                )

            if now >= self._iot_next_flap_at.get(iot_id, now):
                self._iot_flap_until[iot_id] = now + self._settings.simulator_iot_flap_duration_sec
                continue  # start a flap window this tick — skip publishing so it goes stale/offline

            _publish_device_state(
                DeviceState(
                    device_id=iot_id,
                    name=iot_id,
                    type=DeviceType.IOT,
                    pose=Pose2D(
                        frame_id="map",
                        x=anchor_x + random.uniform(-0.05, 0.05),
                        y=anchor_y + random.uniform(-0.05, 0.05),
                        yaw=0.0,
                    ),
                    timestamp=now,
                    battery=random.uniform(60.0, 100.0),
                    speed=None,
                    status={},
                    capabilities=[],
                ),
                self._device_registry,
                self._websocket_manager,
            )

    # ---- anomaly ----

    def _tick_anomaly(self, now: float) -> None:
        if self._active_anomaly_id is not None:
            current = self._anomaly_registry.get(self._active_anomaly_id)
            if current is None or current.status == AnomalyStatus.VERIFIED:
                self._active_anomaly_id = None
            else:
                return  # still detected/en_route/arrived — only one active anomaly at a time

        if now < self._next_anomaly_at:
            return

        execution = self._mission_execution.get_state()
        if execution is None or execution.status != MissionStatus.RUNNING:
            self._next_anomaly_at = now + random.uniform(
                self._settings.simulator_anomaly_min_interval_sec,
                self._settings.simulator_anomaly_max_interval_sec,
            )
            return

        offset = self._settings.simulator_anomaly_offset_m
        anomaly_x = self._robot_pose.x + random.uniform(-offset, offset)
        anomaly_y = self._robot_pose.y + random.uniform(-offset, offset)

        anomaly_id = f"sim-anomaly-{uuid.uuid4().hex[:8]}"
        detected_at = datetime.now(timezone.utc)
        anomaly = Anomaly(
            anomaly_id=anomaly_id,
            x=anomaly_x,
            y=anomaly_y,
            detected_at=detected_at,
            updated_at=detected_at,
            source_device_id=self._robot_id,
            description="Simulated anomaly for local development/demo.",
        )
        self._anomaly_registry.create(anomaly)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.created", "data": anomaly.model_dump(mode="json")}
        )

        self._active_anomaly_id = anomaly_id
        self._detour_target = (anomaly_x, anomaly_y)
        updated = self._anomaly_registry.update_status(anomaly_id, AnomalyStatus.ROBOT_EN_ROUTE)
        self._websocket_manager.broadcast_threadsafe(
            {"type": "anomaly.updated", "data": updated.model_dump(mode="json")}
        )

        self._next_anomaly_at = now + random.uniform(
            self._settings.simulator_anomaly_min_interval_sec, self._settings.simulator_anomaly_max_interval_sec
        )
