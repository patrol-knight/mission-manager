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

    # Durable anomaly-detection history (backend/core/anomaly_repository.py).
    # None means persistence is skipped entirely -- e.g. bare `uvicorn` local
    # dev with no Postgres running -- same optional-service posture as
    # zenoh_enabled/map loading below. Example:
    # postgresql://mission_manager:mission_manager@localhost:5432/mission_manager
    database_url: str | None = None

    zenoh_enabled: bool = False
    zenoh_router: str = "tcp/localhost:7447"
    zenoh_device_state_keyexpr: str = "mission-manager/devices/*/state"
    zenoh_anomaly_keyexpr: str = "mission-manager/anomalies/*/state"
    # Outbound: {device_id} is substituted by ZenohGateway.publish_command().
    zenoh_device_commands_keyexpr: str = "mission-manager/devices/{device_id}/commands"

    # AnomalyResponseCoordinator (core/anomaly_response.py) -- kill switch.
    anomaly_response_enabled: bool = True
    # MissionDriveCoordinator (core/mission_drive.py) -- kill switch for
    # autonomously driving the current mission's waypoints.
    mission_drive_enabled: bool = True

    # Shared by both coordinators above: how long to wait for the tracked
    # robot's operational_state to report "arrived" after a navigate_to_goal
    # command, before giving up (anomaly diversion reverts/clears; mission
    # drive just retries). The robot itself is the source of truth for
    # arrival -- this is only a safety net for a stuck/disconnected robot,
    # not a simulated travel time.
    navigation_timeout_sec: float = 60.0
