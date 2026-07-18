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
