from collections.abc import Sequence

import numpy as np

from models.heatmap import HEAT_VERDICTS, BaselineSpec, ConfidenceRange, HeatEvent, VerdictShares

Polyline = Sequence[tuple[float, float]]

VERSION = 1


def simulate(spec: BaselineSpec, lanes: Sequence[Polyline] = ()) -> list[HeatEvent]:
    """Dummy history over the last `spec.days` days, oldest first. Each hotspot
    draws a Poisson count of events uniformly in time and in its disc; the
    background is spread along the lanes. Deterministic for a given seed."""
    rng = np.random.default_rng(spec.seed)
    events: list[HeatEvent] = []
    for spot in spec.hotspots:
        n = rng.poisson(spot.per_day * spec.days)
        r = spot.radius_m * np.sqrt(rng.random(n))
        theta = rng.random(n) * 2 * np.pi
        points = np.column_stack([spot.x + r * np.cos(theta), spot.y + r * np.sin(theta)])
        events += _draw(rng, points, spec.days, spot.verdicts, spot.types, spot.confidence)
    background = spec.background
    if background.per_day > 0 and lanes:
        n = rng.poisson(background.per_day * spec.days)
        points = _on_lanes(rng, lanes, n)
        events += _draw(rng, points, spec.days, background.verdicts, background.types, background.confidence)
    return sorted(events, key=lambda e: -e.age_days)


def _draw(
    rng: np.random.Generator,
    points: np.ndarray,
    days: float,
    verdicts: VerdictShares,
    types: list[str],
    confidence: ConfidenceRange,
) -> list[HeatEvent]:
    shares = np.array([getattr(verdicts, v) for v in HEAT_VERDICTS])
    picks = rng.choice(len(HEAT_VERDICTS), size=len(points), p=shares / shares.sum())
    return [
        HeatEvent(
            x=round(float(x), 2),
            y=round(float(y), 2),
            age_days=round(float(rng.random() * days), 3),
            verdict=HEAT_VERDICTS[v],
            types=[types[int(rng.integers(len(types)))]],
            confidence=round(float(rng.uniform(confidence.low, confidence.high)), 2),
        )
        for (x, y), v in zip(points, picks, strict=True)
    ]


def _on_lanes(rng: np.random.Generator, lanes: Sequence[Polyline], n: int, lateral_m: float = 1.2) -> np.ndarray:
    lines = [np.asarray(lane, dtype=float) for lane in lanes if len(lane) >= 2]
    lengths = np.array([np.linalg.norm(np.diff(line, axis=0), axis=1).sum() for line in lines])
    picks = rng.choice(len(lines), size=n, p=lengths / lengths.sum())
    points = np.array([_point_at(lines[i], rng.random() * lengths[i]) for i in picks]).reshape(n, 2)
    return points + rng.normal(0.0, lateral_m / 2.0, size=(n, 2))


def _point_at(line: np.ndarray, distance: float) -> np.ndarray:
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg)])
    i = min(int(np.searchsorted(arc, distance, side="right")) - 1, len(seg) - 1)
    t = 0.0 if seg[i] == 0 else (distance - arc[i]) / seg[i]
    return line[i] + t * (line[i + 1] - line[i])
