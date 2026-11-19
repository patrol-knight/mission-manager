from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, model_validator

from models.anomaly import AnomalyType
from models.base import WireModel

# How an anomaly ended: an operator verdict, or "expired" when nobody verified
# it before it went away.
HeatVerdict = Literal["true_positive", "unclear", "false_positive", "expired"]
HEAT_VERDICTS: tuple[HeatVerdict, ...] = ("true_positive", "unclear", "false_positive", "expired")
ANOMALY_TYPES: tuple[AnomalyType, ...] = ("trespassing", "loitering", "lying_down")


class VerdictWeights(WireModel):
    model_config = ConfigDict(extra="forbid")

    true_positive: float = Field(1.0, ge=0.0)
    unclear: float = Field(0.5, ge=0.0)
    false_positive: float = Field(0.15, ge=0.0)
    expired: float = Field(0.3, ge=0.0)


class TypeWeights(WireModel):
    model_config = ConfigDict(extra="forbid")

    trespassing: float = Field(1.0, ge=0.0)
    loitering: float = Field(1.0, ge=0.0)
    lying_down: float = Field(1.0, ge=0.0)


class HeatmapConfig(WireModel):
    """How events turn into heat; backend/core/heatmap/README.md has the math."""

    model_config = ConfigDict(extra="forbid")

    verdict_weights: VerdictWeights = Field(default_factory=VerdictWeights)
    type_weights: TypeWeights = Field(default_factory=TypeWeights)
    # Verdicts whose weight is also scaled by the detector's confidence. A
    # human verdict outranks the detector, so only unverified ones by default.
    confidence_for: list[HeatVerdict] = Field(default_factory=lambda: ["unclear", "expired"])
    # 0 turns the time decay off.
    half_life_days: float = Field(7.0, ge=0.0)
    bandwidth_m: float = Field(4.0, ge=0.5, le=30.0)
    # Heat drawn fully colored; the color scale is linear from 0.
    full_at: float = Field(4.0, gt=0.0)


class VerdictShares(WireModel):
    """Relative shares; normalized when simulating."""

    model_config = ConfigDict(extra="forbid")

    true_positive: float = Field(0.2, ge=0.0)
    unclear: float = Field(0.1, ge=0.0)
    false_positive: float = Field(0.2, ge=0.0)
    expired: float = Field(0.5, ge=0.0)

    @model_validator(mode="after")
    def _not_all_zero(self) -> "VerdictShares":
        if sum(self.model_dump().values()) <= 0:
            raise ValueError("at least one verdict share must be positive")
        return self


class ConfidenceRange(WireModel):
    model_config = ConfigDict(extra="forbid")

    low: float = Field(0.5, ge=0.0, le=1.0)
    high: float = Field(0.95, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _ordered(self) -> "ConfidenceRange":
        if self.low > self.high:
            raise ValueError("confidence low must not exceed high")
        return self


class Hotspot(WireModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    x: float
    y: float
    radius_m: float = Field(3.0, ge=0.0, le=50.0)
    per_day: float = Field(1.0, ge=0.0, le=500.0)
    verdicts: VerdictShares = Field(default_factory=VerdictShares)
    types: list[AnomalyType] = Field(default_factory=lambda: list(ANOMALY_TYPES), min_length=1)
    confidence: ConfidenceRange = Field(default_factory=ConfidenceRange)


class Background(WireModel):
    """Scattered events along the lanes, away from any hotspot."""

    model_config = ConfigDict(extra="forbid")

    per_day: float = Field(0.0, ge=0.0, le=500.0)
    verdicts: VerdictShares = Field(
        default_factory=lambda: VerdictShares(true_positive=0.05, unclear=0.1, false_positive=0.25, expired=0.6)
    )
    types: list[AnomalyType] = Field(default_factory=lambda: list(ANOMALY_TYPES), min_length=1)
    confidence: ConfidenceRange = Field(default_factory=lambda: ConfidenceRange(low=0.3, high=0.8))


class BaselineSpec(WireModel):
    """What the simulator generates the dummy history from."""

    model_config = ConfigDict(extra="forbid")

    days: float = Field(30.0, gt=0.0, le=365.0)
    seed: int = Field(1, ge=0)
    hotspots: list[Hotspot] = Field(default_factory=list)
    background: Background = Field(default_factory=Background)


class HeatEvent(WireModel):
    """One closed anomaly as the estimator sees it. Baseline events are stored
    like this, ages relative to now, so the dummy history never goes stale."""

    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    age_days: float = Field(ge=0.0)
    verdict: HeatVerdict
    types: list[AnomalyType] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)


class RealEvent(WireModel):
    """One line of real.jsonl: an anomaly that closed while this site ran."""

    model_config = ConfigDict(extra="ignore")

    id: str
    x: float
    y: float
    closed_at: datetime
    verdict: HeatVerdict
    types: list[AnomalyType] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    device_id: str | None = None

    def at(self, now: datetime) -> HeatEvent:
        age = max(0.0, (now - self.closed_at).total_seconds() / 86400.0)
        return HeatEvent(
            x=self.x, y=self.y, age_days=age, verdict=self.verdict, types=self.types, confidence=self.confidence
        )


class HeatmapImage(WireModel):
    width: int
    height: int
    # Base64 of width*height uint8 intensities, row 0 = north edge.
    data: str
    # [lon, lat] of the top-left, top-right, bottom-right, bottom-left corners.
    corners: list[list[float]]
    record_count: int


class HeatmapView(WireModel):
    # False when no map is loaded or there are no events yet.
    available: bool
    image: HeatmapImage | None = None


class BaselineInfo(WireModel):
    events: int
    generated_at: str | None = None
    # baseline.yaml changed since baseline.jsonl was generated.
    stale: bool
    merged_real: int = 0


class HeatmapState(WireModel):
    map_name: str
    config: HeatmapConfig
    defaults: HeatmapConfig
    spec: BaselineSpec
    baseline: BaselineInfo
    real_events: int


class DemoEvent(WireModel):
    """A what-if true positive placed in /dev, never saved."""

    lon: float
    lat: float


class PreviewRequest(WireModel):
    model_config = ConfigDict(extra="forbid")

    config: HeatmapConfig
    view: Literal["baseline", "all"] = "all"
    # An unsaved spec to simulate instead of the saved baseline.
    spec: BaselineSpec | None = None
    demo: list[DemoEvent] = Field(default_factory=list, max_length=50)


class PreviewPoint(WireModel):
    lon: float
    lat: float
    verdict: HeatVerdict
    weight: float
    source: Literal["baseline", "real", "demo"]


class HotspotLevel(WireModel):
    name: str
    lon: float
    lat: float
    # Heat at the center / full_at, now and after one more true positive there.
    level: float
    level_after_true: float


class HeatmapPreview(WireModel):
    image: HeatmapImage | None
    points: list[PreviewPoint]
    hotspots: list[HotspotLevel]
    counts: dict[str, int]
    peak_level: float
    elapsed_ms: float
