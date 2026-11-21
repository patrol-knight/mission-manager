from datetime import datetime
from enum import Enum

from pydantic import ConfigDict

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


class InvestigationState(WireModel):
    """The robot's current investigation (core/investigation.py). In memory
    only, same as MissionExecutionState; None when the robot isn't
    investigating."""

    model_config = ConfigDict(extra="forbid")

    kind: InvestigationKind = InvestigationKind.ANOMALY
    anomaly_id: str
    robot_device_id: str
    phase: InvestigationPhase
    # Where it stops: the anomaly snapped onto its nearest lanelet, frozen
    # when the investigation started -- later refreshes don't move the goal.
    target: MapPoint
    target_yaw: float | None = None
    # GeoJSON LineString Feature from the robot to `target`, for the map.
    route: dict
    # The operator's verdict while ON_SITE; None until one is chosen. It is
    # committed only when the robot leaves the anomaly. Only for ANOMALY.
    draft_verdict: AnomalyVerdict | None = None
    started_at: datetime
    arrived_at: datetime | None = None


class StartInvestigationRequest(WireModel):
    anomaly_id: str


class SetVerdictRequest(WireModel):
    verdict: AnomalyVerdict
