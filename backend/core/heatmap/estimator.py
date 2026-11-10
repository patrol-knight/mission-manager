import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from models.heatmap import HeatEvent, HeatmapConfig

CELL_M = 0.5
MAX_CELLS = 400


@dataclass(frozen=True)
class Bounds:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    def padded(self, margin: float) -> "Bounds":
        return Bounds(self.min_x - margin, self.min_y - margin, self.max_x + margin, self.max_y + margin)

    def union(self, other: "Bounds") -> "Bounds":
        return Bounds(
            min(self.min_x, other.min_x), min(self.min_y, other.min_y),
            max(self.max_x, other.max_x), max(self.max_y, other.max_y),
        )


@dataclass(frozen=True)
class HeatGrid:
    bounds: Bounds
    # Weighted event count around each cell; row 0 is the max_y edge.
    heat: np.ndarray
    # heat / full_at, clipped to [0, 1].
    values: np.ndarray
    record_count: int

    def to_uint8(self) -> np.ndarray:
        return np.rint(self.values * 255).astype(np.uint8)


def weight(event: HeatEvent, config: HeatmapConfig) -> float:
    w = getattr(config.verdict_weights, event.verdict)
    w *= max(getattr(config.type_weights, t) for t in event.types)
    if event.verdict in config.confidence_for:
        w *= event.confidence
    if config.half_life_days > 0:
        w *= 0.5 ** (event.age_days / config.half_life_days)
    return w


def heat_at(events: Sequence[HeatEvent], config: HeatmapConfig, x: float, y: float) -> float:
    if not events:
        return 0.0
    xs = np.array([e.x for e in events])
    ys = np.array([e.y for e in events])
    ws = np.array([weight(e, config) for e in events])
    d2 = (xs - x) ** 2 + (ys - y) ** 2
    return float((ws * np.exp(-d2 / (2 * config.bandwidth_m**2))).sum())


def render(events: Sequence[HeatEvent], config: HeatmapConfig, bounds: Bounds | None = None) -> HeatGrid | None:
    """Sum of peak-1 Gaussians, one per event scaled by its weight, on a grid
    over the bounds (and every event) padded by 3 sigma."""
    if not events:
        return None
    xs = np.array([e.x for e in events])
    ys = np.array([e.y for e in events])
    ws = np.array([weight(e, config) for e in events])
    sigma = config.bandwidth_m

    extent = Bounds(float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max()))
    if bounds is not None:
        extent = extent.union(bounds)
    extent = extent.padded(3.0 * sigma)
    cell = max(CELL_M, max(extent.max_x - extent.min_x, extent.max_y - extent.min_y) / MAX_CELLS)
    cols = max(1, math.ceil((extent.max_x - extent.min_x) / cell))
    rows = max(1, math.ceil((extent.max_y - extent.min_y) / cell))
    extent = Bounds(extent.min_x, extent.max_y - rows * cell, extent.min_x + cols * cell, extent.max_y)

    col = np.floor((xs - extent.min_x) / cell).astype(int)
    row = np.floor((extent.max_y - ys) / cell).astype(int)
    binned = np.zeros((rows, cols))
    np.add.at(binned, (row, col), ws)
    # Separable blur: K_rows · B · K_colsᵀ.
    heat = _kernel(rows, cell, sigma) @ binned @ _kernel(cols, cell, sigma).T
    return HeatGrid(
        bounds=extent,
        heat=heat.astype(np.float32),
        values=np.clip(heat / config.full_at, 0.0, 1.0).astype(np.float32),
        record_count=len(events),
    )


def _kernel(n: int, cell: float, sigma: float) -> np.ndarray:
    offsets = (np.arange(n)[:, None] - np.arange(n)[None, :]) * cell
    return np.exp(-0.5 * (offsets / sigma) ** 2)
