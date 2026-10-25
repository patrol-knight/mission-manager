from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, field_validator

from models.base import WireModel

# The anomaly categories Anomaly Detection may report -- see
# ../anomaly_detection/docs/topics_format.md section 2.1.
AnomalyType = Literal["lying_down", "loitering", "trespassing"]
# What the operator can conclude on site. Only the first two are final and
# sent to Anomaly Detection as feedback; "unclear" (camera blocked, person
# already gone, ...) keeps the anomaly on the map for another look.
AnomalyResolution = Literal["true_positive", "false_positive"]
AnomalyVerdict = Literal["true_positive", "false_positive", "unclear"]
FINAL_VERDICTS: tuple[AnomalyResolution, ...] = ("true_positive", "false_positive")


class AnomalyStateMessage(WireModel):
    """Wire payload on anomalies/{anomaly_id}/state, published by Anomaly
    Detection (../anomaly_detection/docs/topics_format.md section 2.1). The
    first message for an id creates the anomaly; every later one refreshes it
    and carries every field again. Unknown fields are ignored so the producer
    can add fields without breaking ingest."""

    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    anomaly_id: str = Field(min_length=1)
    types: list[AnomalyType] = Field(min_length=1)
    x: float
    y: float
    frame_id: Literal["map"] = "map"
    confidence: float = Field(ge=0.0, le=1.0)
    source_device_id: str = Field(min_length=1)
    detected_at: float = Field(gt=0.0)  # epoch seconds, fixed for the whole event
    updated_at: float = Field(gt=0.0)  # epoch seconds, producer's publish time
    degrade_sec: float = Field(gt=0.0)

    @field_validator("types")
    @classmethod
    def _check_unique_types(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("types must not contain duplicates")
        return value


class AnomalyFeedbackMessage(WireModel):
    """Wire payload on anomalies/{anomaly_id}/feedback, published by this
    backend once the operator resolves an anomaly (section 2.2 of the same
    doc). Anomaly Detection stops publishing that id afterwards."""

    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    resolution: AnomalyResolution
    resolved_at: float  # epoch seconds


class Anomaly(WireModel):
    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    types: list[AnomalyType]
    x: float
    y: float
    frame_id: str = "map"
    confidence: float = Field(ge=0.0, le=1.0)
    source_device_id: str
    # From the first state message; never changes on refresh.
    detected_at: datetime
    # Last time this record changed for any reason (refresh or verdict).
    updated_at: datetime
    # Receive time of the last state message -- backend clock, not the
    # producer's, so device clock skew doesn't matter.
    last_seen_at: datetime
    degrade_sec: float
    # max(previous expires_at, receive time + degrade_sec), per the contract's
    # lifetime rule. AnomalyRegistry.expire() removes the anomaly once this
    # passes, unless the robot is investigating it.
    expires_at: datetime
    # Computed once per message, server-side, at Zenoh ingest time (see
    # transport/zenoh_gateway.py's ingest_anomaly_payload) using MapServer's
    # real lanelet2 projector -- never set by an incoming anomaly payload
    # itself. Same rationale as Pose2D.lat/lon in models/device.py.
    lat: float | None = None
    lon: float | None = None
    # The operator's verdict, set by AnomalyRegistry.resolve() when the robot
    # leaves the anomaly. None = never verified. A final verdict
    # (FINAL_VERDICTS) closes the anomaly; "unclear" leaves it on the map.
    resolution: AnomalyVerdict | None = None
    resolved_at: datetime | None = None
    # The current mission when the verdict was given, if any.
    mission_id: str | None = None

    @property
    def is_closed(self) -> bool:
        return self.resolution in FINAL_VERDICTS
