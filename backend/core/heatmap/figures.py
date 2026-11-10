"""Regenerates the figures in README.md from storage/heatmap/nsh:

    .venv/bin/python -m core.heatmap.figures

Needs the dev dependency group (pyproject.toml)."""

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

from core.heatmap.estimator import Bounds, heat_at, render, weight  # noqa: E402
from core.heatmap.store import HeatmapStore  # noqa: E402
from core.map_server import MapServer  # noqa: E402
from models.heatmap import HeatEvent, HeatmapConfig  # noqa: E402

BACKEND = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "images"
MAP = "nsh"

# Same stops as the frontend's heatmapColormap.ts.
HEAT = LinearSegmentedColormap.from_list("heat", [
    (0.0, (0.984, 0.749, 0.141, 0.0)),
    (0.08, (0.984, 0.749, 0.141, 0.0)),
    (0.3, (0.984, 0.749, 0.141, 0.55)),
    (0.65, (0.976, 0.451, 0.086, 0.8)),
    (1.0, (0.886, 0.255, 0.169, 0.95)),
])
VERDICT_COLORS = {"true_positive": "#c51e3a", "unclear": "#6b7280", "false_positive": "#16a34a", "expired": "#b8bcc4"}
VERDICT_LABELS = {"true_positive": "True", "unclear": "Unclear", "false_positive": "False", "expired": "Expired"}
INK, MUTED = "#111827", "#6b7280"

plt.rcParams.update({
    "font.size": 10, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
    "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 130,
})


def draw_map(ax, lanes, events, config, bounds, title, spec=None, demo=()):
    for lane in lanes:
        xs, ys = zip(*lane, strict=True)
        ax.plot(xs, ys, color="#9ca3af", lw=0.8, zorder=1)
    grid = render(list(events) + list(demo), config, bounds)
    b = grid.bounds
    ax.imshow(grid.values, cmap=HEAT, vmin=0, vmax=1, extent=(b.min_x, b.max_x, b.min_y, b.max_y), zorder=2)
    for verdict, color in VERDICT_COLORS.items():
        pts = [e for e in events if e.verdict == verdict]
        ax.scatter([e.x for e in pts], [e.y for e in pts], s=8, c=color, edgecolors="white", linewidths=0.4, zorder=3)
    if demo:
        ax.scatter([e.x for e in demo], [e.y for e in demo], s=40, c=VERDICT_COLORS["true_positive"],
                   edgecolors=INK, linewidths=1.2, zorder=4)
    for spot in spec.hotspots if spec else []:
        level = heat_at(list(events) + list(demo), config, spot.x, spot.y) / config.full_at
        ax.annotate(f"{spot.name}\n{level:.0%}", (spot.x, spot.y), xytext=(8, 8), textcoords="offset points",
                    fontsize=8, color=INK, zorder=5)
    ax.set_xlim(bounds.min_x - 6, bounds.max_x + 6)
    ax.set_ylim(bounds.min_y - 6, bounds.max_y + 6)
    ax.set_aspect("equal")
    ax.set_title(title, color=INK, loc="left", fontsize=10)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)


def verdict_legend(fig):
    handles = [plt.Line2D([], [], marker="o", ls="", color=c, label=VERDICT_LABELS[v]) for v, c in VERDICT_COLORS.items()]
    fig.legend(handles=handles, loc="lower center", ncol=4, frameon=False, bbox_to_anchor=(0.5, 0.02))


def weights_figure(config: HeatmapConfig):
    ages = np.linspace(0, 35, 200)
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    for verdict, color in VERDICT_COLORS.items():
        ws = [weight(HeatEvent(x=0, y=0, age_days=a, verdict=verdict, types=["trespassing"], confidence=0.7), config)
              for a in ages]
        ax.plot(ages, ws, color=color, lw=2, label=VERDICT_LABELS[verdict])
    ax.set_xlabel("Days since the anomaly closed")
    ax.set_ylabel("Weight")
    ax.set_ylim(0, 1.05)
    ax.grid(axis="y", color="#e5e7eb", lw=0.6)
    ax.legend(frameon=False)
    ax.set_title("Weight of one event (confidence 0.7, half-life 7 days)", loc="left", color=INK)
    fig.tight_layout()
    fig.savefig(OUT / "weights.png", bbox_inches="tight")


def main() -> None:
    OUT.mkdir(exist_ok=True)
    server = MapServer()
    maps = BACKEND / "storage" / "maps" / MAP
    server.load(str(maps / "lanelet2_map.osm"), str(maps / "map_projector_info.yaml"))
    store = HeatmapStore(BACKEND / "storage" / "heatmap" / MAP)
    config, spec = store.config(), store.spec()
    events = store.baseline()[1]
    lanes = server.centerlines_xy()
    bounds = Bounds(*server.get_xy_bounds())

    weights_figure(config)

    fig, ax = plt.subplots(figsize=(4.6, 5.6))
    draw_map(ax, lanes, events, config, bounds, f"Baseline: {len(events)} events over {spec.days:g} days", spec)
    verdict_legend(fig)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(OUT / "baseline.png", bbox_inches="tight")

    demo_spot = next(s for s in spec.hotspots if "Demo" in s.name)
    def trues(n):
        return [HeatEvent(x=demo_spot.x + dx, y=demo_spot.y + dy, age_days=0, verdict="true_positive",
                          types=["trespassing"], confidence=1.0) for dx, dy in [(0.5, 0.3), (-0.6, 0.8), (0.2, -0.9)][:n]]
    fig, axes = plt.subplots(1, 3, figsize=(11, 5.4))
    for ax, n in zip(axes, (0, 1, 3), strict=True):
        title = "Baseline" if n == 0 else f"+ {n} true at the demo spot"
        draw_map(ax, lanes, events, config, bounds, title, spec, trues(n))
    verdict_legend(fig)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(OUT / "demo.png", bbox_inches="tight")

    fig, axes = plt.subplots(1, 3, figsize=(11, 5.4))
    for ax, days in zip(axes, (3, 7, 21), strict=True):
        draw_map(ax, lanes, events, config.model_copy(update={"half_life_days": days}), bounds,
                 f"Half-life {days} days", spec)
    verdict_legend(fig)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(OUT / "half_life.png", bbox_inches="tight")
    plt.close("all")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
