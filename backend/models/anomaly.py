from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict


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
