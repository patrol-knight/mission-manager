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
    # How long the robot may stay offline before the mission and any
    # investigation are aborted (MissionService.abort_if_robot_lost). Longer
    # than device_offline_timeout_sec, which only drives the UI's connection
    # dot, so a short network blip doesn't stop a mission.
    robot_lost_grace_sec: float = 10.0
    device_monitor_interval_sec: float = 1.0

    # Durable anomaly-detection history (backend/core/anomaly_repository.py).
    # None means persistence is skipped entirely -- e.g. bare `uvicorn` local
    # dev with no Postgres running -- same optional-service posture as
    # zenoh_enabled/map loading below. Example:
    # postgresql://mission_manager:mission_manager@localhost:5432/mission_manager
    database_url: str | None = None

    zenoh_enabled: bool = False
    zenoh_router: str = "tcp/localhost:7447"
    zenoh_device_state_keyexpr: str = "devices/*/state"
    zenoh_anomaly_keyexpr: str = "anomalies/*/state"
    # Outbound: {anomaly_id} is substituted by ZenohGateway.publish_anomaly_feedback().
    zenoh_anomaly_feedback_keyexpr: str = "anomalies/{anomaly_id}/feedback"
    # Outbound: {device_id} is substituted by ZenohGateway.publish_command().
    zenoh_device_commands_keyexpr: str = "devices/{device_id}/commands"

    # Video streaming (see ../zenoh_bridge/docs/video_streaming_pipeline.md).
    # start_camera_stream/stop_camera_stream commands ride the existing
    # zenoh_device_commands_keyexpr above -- no separate outbound key needed.
    zenoh_camera_state_keyexpr: str = "devices/*/cameras/*/state"
    zenoh_camera_webrtc_to_backend_keyexpr: str = (
        "devices/*/cameras/*/webrtc/to-backend"
    )
    # Outbound: {device_id}/{camera_id} substituted by ZenohGateway.publish_camera_signal().
    zenoh_camera_webrtc_to_device_keyexpr: str = (
        "devices/{device_id}/cameras/{camera_id}/webrtc/to-device"
    )
    # Every gateway CommandResult (accepted/running/succeeded/rejected/failed).
    zenoh_device_events_keyexpr: str = "devices/*/events"

    # Camera sessions (core/camera_stream.py). How long Start/Stop wait for
    # the gateway's definitive CommandResult before answering 504/202.
    camera_command_timeout_sec: float = 3.0
    # How long a session survives its owner's WebSocket dropping before the
    # backend stops it, so a reconnecting page can resume it.
    camera_owner_grace_sec: float = 10.0
    # A session the backend is cancelling (Start timed out) or stopping
    # without a confirmation is forgotten after this long, if no camera state
    # has settled it first.
    camera_unconfirmed_expiry_sec: float = 30.0

    # MissionDriveCoordinator (core/mission_drive.py) -- kill switch for
    # autonomously driving the current mission's waypoints.
    mission_drive_enabled: bool = True

    # MissionDriveCoordinator: how long to wait for the robot to report
    # "arrived" after a waypoint navigate_to_goal before re-sending it. The
    # robot is the source of truth for arrival -- this is only a safety net
    # for a lost command, not a simulated travel time. (Investigations
    # deliberately have no timeout; the operator decides when to Stop.)
    navigation_timeout_sec: float = 60.0
