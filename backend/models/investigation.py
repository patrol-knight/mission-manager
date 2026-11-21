from datetime import datetime
from enum import Enum

from pydantic import ConfigDict, model_validator

from models.anomaly import AnomalyVerdict
from models.base import WireModel
from models.map import MapPoint


class InvestigationPhase(str, Enum):
    EN_ROUTE = "en_route"
    ON_SITE = "on_site"


class InvestigationKind(str, Enum):
    # Sent to an anomaly; ends with a verdict.
    ANOMALY = "anomaly"
    # Sent to a tower whose camera is unhealthy (a camera_unhealthy anomaly),
    # to look in its place; no verdict, and nothing goes back to Anomaly
    # Detection.
    CAMERA = "camera"
    # Explore: sent by the operator to look at a point of their choosing (no
    # anomaly there, or no tower sees it); no verdict.
    EXPLORE = "explore"


class InvestigationState(WireModel):
    """The robot's current investigation (core/investigation.py). In memory
    only, same as MissionExecutionState; None when the robot isn't
    investigating."""

    model_config = ConfigDict(extra="forbid")

    kind: InvestigationKind = InvestigationKind.ANOMALY
    # Set exactly when kind isn't EXPLORE.
    anomaly_id: str | None = None
    robot_device_id: str
    phase: InvestigationPhase
    # What the robot is sent to look at: the anomaly, or the explored point.
    look_at: MapPoint
    # Where it stops to look (core/investigation.py _goal), frozen when the
    # investigation started -- later refreshes don't move the goal.
    target: MapPoint
    target_yaw: float | None = None
    # GeoJSON LineString Feature from the robot to `target`, for the map.
    route: dict
    # The operator's verdict while ON_SITE; None until one is chosen. It is
    # committed only when the robot leaves the anomaly. Only for ANOMALY.
    draft_verdict: AnomalyVerdict | None = None
    started_at: datetime
    arrived_at: datetime | None = None

    @model_validator(mode="after")
    def _anomaly_matches_kind(self) -> "InvestigationState":
        if (self.anomaly_id is None) != (self.kind == InvestigationKind.EXPLORE):
            raise ValueError("anomaly_id is set exactly when kind isn't explore")
        return self


class StartInvestigationRequest(WireModel):
    anomaly_id: str


class SetVerdictRequest(WireModel):
    verdict: AnomalyVerdict


class ExploreRequest(WireModel):
    lat: float
    lon: float


class ExplorePreview(WireModel):
    """Where Explore would send the robot to look at a point, without sending it."""

    look_at: MapPoint
    target: MapPoint
    length_m: float
