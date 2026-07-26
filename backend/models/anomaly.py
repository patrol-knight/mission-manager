from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class AnomalyStatus(str, Enum):
    DETECTED = "detected"
    ROBOT_EN_ROUTE = "robot_en_route"
    ROBOT_ARRIVED = "robot_arrived"
    VERIFIED = "verified"


class Anomaly(BaseModel):
    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    x: float
    y: float
    frame_id: str = "map"
    status: AnomalyStatus = AnomalyStatus.DETECTED
    detected_at: datetime
    updated_at: datetime
    source_device_id: str | None = None
    description: str | None = None
    # Detection confidence from the (real or simulated) anomaly-detection
    # service, 0-1. Optional since not every producer of this shape sets it.
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    # Computed once, server-side, at Zenoh ingest time (see
    # transport/zenoh_gateway.py's ingest_anomaly_payload) using MapServer's
    # real lanelet2 projector -- never set by an incoming anomaly payload
    # itself. Same rationale as Pose2D.lat/lon in models/device.py.
    lat: float | None = None
    lon: float | None = None
