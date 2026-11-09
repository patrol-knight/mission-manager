"""Synthetic history, ported from modules/heatmap/devtools (seed.py, scenario.py)."""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np
import yaml

TYPES = ("lying_down", "loitering", "trespassing")
SCENARIO_VERDICTS = ("true_positive", "false_positive", "unclear")

Generated = list[tuple[dict, list[dict], list[dict]]]


class LaneMap:
    def __init__(
        self,
        name: str,
        osm_hash: str | None,
        centerlines: list[list[tuple[float, float]]],
        to_latlon: Callable[[float, float], tuple[float, float]],
    ) -> None:
        self.name = name
        self.osm_hash = osm_hash
        self.centerlines = [np.asarray(c, dtype=float) for c in centerlines if len(c) >= 2]
        self._to_latlon = to_latlon

    def sample_on_lanes(self, rng: np.random.Generator, n: int, lateral_m: float = 1.2) -> np.ndarray:
        lengths = np.array([_length(c) for c in self.centerlines])
        picks = rng.choice(len(self.centerlines), size=n, p=lengths / lengths.sum())
        points = np.empty((n, 2))
        for i, lane in enumerate(picks):
            points[i] = _point_at(self.centerlines[lane], rng.random() * lengths[lane])
        return points + rng.normal(0.0, lateral_m / 2.0, size=(n, 2))

    def reverse(self, xs, ys) -> tuple[list[float], list[float]]:
        lats, lons = [], []
        for x, y in zip(xs, ys, strict=True):
            lat, lon = self._to_latlon(float(x), float(y))
            lats.append(lat)
            lons.append(lon)
        return lats, lons


def _length(line: np.ndarray) -> float:
    return float(np.linalg.norm(np.diff(line, axis=0), axis=1).sum())


def _point_at(line: np.ndarray, distance: float) -> np.ndarray:
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    i = min(int(np.searchsorted(arc, distance, side="right")) - 1, len(seg) - 1)
    t = 0.0 if seg[i] == 0 else (distance - arc[i]) / seg[i]
    return line[i] + t * (line[i + 1] - line[i])


SEED_VERDICTS = ("true_positive", "unclear", None, "false_positive")
HOTSPOT_VERDICTS = (0.5, 0.2, 0.2, 0.1)
BACKGROUND_VERDICTS = (0.08, 0.15, 0.5, 0.27)
SEED_DEVICES = ("iot-01", "iot-02", "iot-03", "husky-sim-01")


def seed(
    lane_map: LaneMap,
    source: str,
    sessions: int,
    anomalies_per_session: int,
    days: float,
    hotspots: int,
    hotspot_share: float,
    seed: int | None = None,
) -> Generated:
    rng = np.random.default_rng(seed)
    now = datetime.now(timezone.utc)
    centers = lane_map.sample_on_lanes(rng, hotspots, lateral_m=0.0)
    spreads = rng.uniform(1.5, 3.5, size=hotspots)
    active_from = rng.uniform(0.0, 0.6, size=hotspots)
    active_to = np.minimum(1.0, active_from + rng.uniform(0.4, 1.0, size=hotspots))

    starts = np.sort(rng.uniform(0.0, 1.0, size=sessions))
    result = []
    for start in starts:
        started_at = now - timedelta(days=days * (1.0 - start))
        duration = timedelta(hours=float(rng.uniform(1.0, 4.0)))
        ended_at = min(started_at + duration, now)
        session_id = uuid.uuid4()

        live = np.flatnonzero((active_from <= start) & (start <= active_to))
        n_hot = int(rng.binomial(anomalies_per_session, hotspot_share)) if len(live) else 0
        points = []
        if n_hot:
            which = rng.choice(live, size=n_hot)
            points += [(c, True) for c in centers[which] + rng.normal(size=(n_hot, 2)) * spreads[which, None]]
        points += [(p, False) for p in lane_map.sample_on_lanes(rng, anomalies_per_session - n_hot)]

        xs = [float(p[0][0]) for p in points]
        ys = [float(p[0][1]) for p in points]
        lats, lons = lane_map.reverse(xs, ys)
        anomalies = []
        for (_, hot), x, y, lat, lon in zip(points, xs, ys, lats, lons, strict=True):
            resolution = SEED_VERDICTS[rng.choice(4, p=HOTSPOT_VERDICTS if hot else BACKGROUND_VERDICTS)]
            detected_at = started_at + (ended_at - started_at) * float(rng.random())
            closed_at = min(detected_at + timedelta(seconds=float(rng.uniform(20, 240))), now)
            confidence = float(rng.uniform(0.75, 0.99) if resolution == "true_positive" else rng.uniform(0.55, 0.95))
            anomalies.append({
                "anomaly_id": str(uuid.uuid4()),
                "types": list(rng.choice(TYPES, size=1 if rng.random() < 0.75 else 2, replace=False)),
                "x": x,
                "y": y,
                "lat": lat,
                "lon": lon,
                "confidence": confidence,
                "source_device_id": str(rng.choice(SEED_DEVICES)),
                "detected_at": detected_at,
                "last_seen_at": closed_at,
                "mission_id": None,
                "resolution": resolution,
                "closed_at": closed_at,
                "session_id": session_id,
            })
        result.append((_session(session_id, lane_map, source, started_at, ended_at, "Seeded"), anomalies, []))
    return result


def _session(session_id: uuid.UUID, lane_map: LaneMap, source: str, started: datetime, ended: datetime,
             label: str) -> dict:
    return {
        "id": session_id,
        "map_name": lane_map.name,
        "map_hash": lane_map.osm_hash,
        "source": source,
        "started_at": started,
        "ended_at": ended,
        "label": label,
    }


@dataclass
class Device:
    id: str
    at: tuple[float, float] | None = None
    type: str = "iot"
    # 1 = the most recent day.
    offline_days_ago: list[int] = field(default_factory=list)


@dataclass
class Verification:
    dispatch_share: float = 0.3
    dispatch_delay_s: tuple[float, float] = (3.0, 20.0)
    travel_s: tuple[float, float] = (20.0, 120.0)
    unclear_share: float = 0.1


@dataclass
class Hotspot:
    name: str
    at: tuple[float, float]
    rate_per_hour: float
    radius_m: float = 3.0
    types: list[str] = field(default_factory=lambda: list(TYPES))
    true_share: float = 0.3
    dispatch_share: float | None = None
    # Default: the nearest tower.
    device: str | None = None
    # Legacy fixed verdict shares; overrides true_share/dispatch_share.
    verdicts: dict[str, float] | None = None


@dataclass
class Scenario:
    name: str
    source: str
    days: int
    hours_per_day: float
    start_hour: float
    devices: list[Device]
    hotspots: list[Hotspot]
    background: Hotspot
    verification: Verification
    seed: int | None

    @classmethod
    def from_yaml(cls, text: str) -> "Scenario":
        raw = yaml.safe_load(text) or {}
        if not isinstance(raw, dict):
            raise ValueError("a scenario is a YAML mapping")
        try:
            background = {"rate_per_hour": 0.0, **raw.get("background", {})}
            verification = raw.get("verification", {})
            scenario = cls(
                name=str(raw.get("name", "Scenario")),
                source=raw.get("source", "sim"),
                days=int(raw.get("days", 14)),
                hours_per_day=float(raw.get("hours_per_day", 8)),
                start_hour=float(raw.get("start_hour", 9)),
                devices=[
                    Device(**{**d, "id": str(d["id"]), "at": tuple(d["at"]) if d.get("at") is not None else None})
                    for d in raw.get("devices", [])
                ],
                hotspots=[Hotspot(**{**h, "at": tuple(h["at"])}) for h in raw.get("hotspots", [])],
                background=Hotspot(name="background", at=(0.0, 0.0), **background),
                verification=Verification(
                    **{k: tuple(v) if isinstance(v, list) else v for k, v in verification.items()}
                ),
                seed=raw.get("seed"),
            )
        except (TypeError, KeyError, AttributeError) as exc:
            raise ValueError(f"malformed scenario: {exc}") from exc
        scenario.validate()
        return scenario

    def validate(self) -> None:
        if self.source not in {"sim", "real"}:
            raise ValueError("source must be sim or real")
        if not 1 <= self.days <= 365 or not 0 < self.hours_per_day <= 24:
            raise ValueError("days must be in [1, 365] and hours_per_day in (0, 24]")
        if not self.devices:
            raise ValueError("at least one device is needed to attribute alerts")
        for device in self.devices:
            if device.type not in {"iot", "robot"}:
                raise ValueError(f"device {device.id}: type must be iot or robot")
            if device.type == "iot" and device.at is None:
                raise ValueError(f"device {device.id}: a tower needs `at`")
        ids = {d.id for d in self.devices}
        has_towers = any(d.type == "iot" for d in self.devices)
        for spot in [*self.hotspots, self.background]:
            if set(spot.types) - set(TYPES):
                raise ValueError(f"{spot.name}: types must be among {TYPES}")
            if spot.rate_per_hour < 0:
                raise ValueError(f"{spot.name}: rate_per_hour must be >= 0")
            shares = [spot.true_share, spot.dispatch_share if spot.dispatch_share is not None else 0.0]
            if not all(0.0 <= s <= 1.0 for s in shares):
                raise ValueError(f"{spot.name}: shares must be in [0, 1]")
            if spot.verdicts is not None and (
                sum(spot.verdicts.values()) > 1 or set(spot.verdicts) - set(SCENARIO_VERDICTS)
            ):
                raise ValueError(f"{spot.name}: verdicts are {SCENARIO_VERDICTS} shares summing to <= 1")
            if spot.device is not None and spot.device not in ids:
                raise ValueError(f"{spot.name}: unknown device {spot.device}")
            if spot.device is None and spot.rate_per_hour > 0 and not has_towers:
                raise ValueError(f"{spot.name}: no tower to attribute it to; set `device`")
        if not 0.0 <= self.verification.dispatch_share <= 1.0:
            raise ValueError("verification.dispatch_share must be in [0, 1]")

    def generate(self, lane_map: LaneMap, now: datetime | None = None) -> Generated:
        rng = np.random.default_rng(self.seed)
        now = now or datetime.now(timezone.utc)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        towers = [i for i, d in enumerate(self.devices) if d.type == "iot"]
        tower_xy = np.array([self.devices[i].at for i in towers]) if towers else np.zeros((0, 2))
        index = {d.id: i for i, d in enumerate(self.devices)}
        hours = self.hours_per_day

        result = []
        for day in range(self.days, 0, -1):
            started_at = today - timedelta(days=day) + timedelta(hours=self.start_hour)
            ended_at = started_at + timedelta(hours=hours)
            session_id = uuid.uuid4()
            online = np.array([day not in d.offline_days_ago for d in self.devices])

            points: list[tuple[np.ndarray, Hotspot]] = []
            for spot in self.hotspots:
                n = rng.poisson(spot.rate_per_hour * hours)
                radius = spot.radius_m * np.sqrt(rng.random(n))
                theta = rng.uniform(0, 2 * np.pi, n)
                offsets = np.stack([radius * np.cos(theta), radius * np.sin(theta)], axis=1)
                points += [(np.array(spot.at) + o, spot) for o in offsets]
            n = rng.poisson(self.background.rate_per_hour * hours)
            if n:
                points += [(p, self.background) for p in lane_map.sample_on_lanes(rng, n)]

            anomalies = []
            if points:
                xy = np.array([p[0] for p in points])
                nearest = (
                    np.array(towers)[np.argmin(np.linalg.norm(xy[:, None, :] - tower_xy[None, :, :], axis=2), axis=1)]
                    if towers else np.zeros(len(points), dtype=int)
                )
                detector = np.array([index[spot.device] if spot.device else n for (_, spot), n in zip(points, nearest, strict=True)])
                seen = online[detector]
                lats, lons = lane_map.reverse(xy[:, 0], xy[:, 1])
                for (position, spot), lat, lon, device, visible in zip(points, lats, lons, detector, seen, strict=True):
                    if not visible:
                        continue
                    detected_at = started_at + timedelta(hours=float(rng.uniform(0, hours)))
                    outcome = _verify(rng, spot, self.verification, detected_at)
                    closed_at = min(outcome["closed_at"], ended_at)
                    anomalies.append({
                        "anomaly_id": str(uuid.uuid4()),
                        "types": list(rng.choice(
                            spot.types, size=1 if rng.random() < 0.8 or len(spot.types) == 1 else 2, replace=False,
                        )),
                        "x": float(position[0]),
                        "y": float(position[1]),
                        "lat": lat,
                        "lon": lon,
                        "confidence": float(rng.uniform(0.8, 0.99)),
                        "source_device_id": self.devices[device].id,
                        "detected_at": detected_at,
                        "last_seen_at": closed_at,
                        "mission_id": None,
                        "session_id": session_id,
                        **outcome,
                        "closed_at": closed_at,
                    })
            uptime = [
                {
                    "id": uuid.uuid4(), "session_id": session_id, "device_id": d.id, "device_type": d.type,
                    "x": float(d.at[0]) if d.at else None, "y": float(d.at[1]) if d.at else None,
                    "started_at": started_at, "last_seen_at": ended_at,
                }
                for d, up in zip(self.devices, online, strict=True) if up
            ]
            result.append((_session(session_id, lane_map, self.source, started_at, ended_at, self.name),
                           anomalies, uptime))
        return result


def _verify(rng: np.random.Generator, spot: Hotspot, verification: Verification, detected_at: datetime) -> dict:
    none = {"dispatched_at": None, "arrived_at": None}
    if spot.verdicts is not None:
        return {**none, "resolution": _pick(rng, spot.verdicts),
                "closed_at": detected_at + timedelta(seconds=float(rng.uniform(20, 240)))}

    dispatch_share = verification.dispatch_share if spot.dispatch_share is None else spot.dispatch_share
    if rng.random() >= dispatch_share:
        return {**none, "resolution": None, "closed_at": detected_at + timedelta(seconds=float(rng.uniform(5, 40)))}
    dispatched_at = detected_at + timedelta(seconds=float(rng.uniform(*verification.dispatch_delay_s)))
    arrived_at = dispatched_at + timedelta(seconds=float(rng.uniform(*verification.travel_s)))
    real = rng.random() < spot.true_share
    if rng.random() < verification.unclear_share:
        resolution = "unclear"
    else:
        resolution = "true_positive" if real else "false_positive"
    return {
        "dispatched_at": dispatched_at,
        "arrived_at": arrived_at,
        "resolution": resolution,
        "closed_at": arrived_at + timedelta(seconds=float(rng.uniform(20, 90))),
    }


def _pick(rng: np.random.Generator, shares: dict[str, float]) -> str | None:
    r = rng.random()
    for verdict, share in shares.items():
        if r < share:
            return verdict
        r -= share
    return None
