from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict

from models.anomaly import AnomalyVerdict
from models.map import MapPoint


class InvestigationPhase(str, Enum):
    EN_ROUTE = "en_route"
    ON_SITE = "on_site"


class InvestigationState(BaseModel):
    """The robot's current investigation (core/investigation.py). In memory
    only, same as MissionExecutionState; None when the robot isn't
    investigating."""

    model_config = ConfigDict(extra="forbid")

    anomaly_id: str
    robot_device_id: str
    phase: InvestigationPhase
    # The anomaly's position snapped to the lanelet network, frozen when the
    # investigation started -- later refreshes don't move the robot's goal.
    target: MapPoint
    # GeoJSON LineString Feature from the robot to `target`, for the map.
    route: dict
    # The operator's verdict while ON_SITE; None until one is chosen. It is
    # committed only when the robot leaves the anomaly.
    draft_verdict: AnomalyVerdict | None = None
    started_at: datetime
    arrived_at: datetime | None = None


class StartInvestigationRequest(BaseModel):
    anomaly_id: str


class SetVerdictRequest(BaseModel):
    verdict: AnomalyVerdict
