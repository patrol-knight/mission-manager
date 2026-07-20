from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000

    cors_origins: list[str] = ["http://localhost:5173"]

    map_osm_path: str = "storage/maps/lanelet2_map.osm"
    map_projector_path: str = "storage/maps/map_projector_info.yaml"

    mission_folder: str = "storage/missions"
    app_state_path: str = "storage/app_state.yaml"

    device_offline_timeout_sec: float = 3.0
    device_monitor_interval_sec: float = 1.0

    zenoh_enabled: bool = False
    zenoh_router: str = "tcp/localhost:7447"
    zenoh_device_state_keyexpr: str = "mission-manager/devices/*/state"

    # Dev-only simulator (backend/simulation/dev_simulator.py) — off by default.
    # See .env.example / .env.demo for local-demo usage. If both this and
    # ZENOH_ENABLED are true, keep simulator device ids disjoint from real
    # Zenoh-published device ids (see bootstrap.py's startup warning).
    simulator_enabled: bool = False
    simulator_tick_interval_sec: float = 0.5

    simulator_robot_device_id: str = "sim-robot-01"
    simulator_robot_speed_mps: float = 1.0

    simulator_iot_device_ids: list[str] = ["sim-iot-01", "sim-iot-02", "sim-iot-03"]
    simulator_iot_flap_min_sec: float = 15.0
    simulator_iot_flap_max_sec: float = 45.0
    simulator_iot_flap_duration_sec: float = 6.0

    simulator_anomaly_min_interval_sec: float = 20.0
    simulator_anomaly_max_interval_sec: float = 60.0
    simulator_anomaly_offset_m: float = 1.5
