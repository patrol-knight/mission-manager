import bisect

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .reader import Run  # noqa: E402
from .summary import nums  # noqa: E402

LOST = "#c51e3a"
DOWN = "#fde2e4"
DPI = 150


def _t(run: Run, rows: list[dict]) -> list[float]:
    return [r["t"] - run.t0 for r in rows]


def _y(rows: list[dict], key: str) -> list[float | None]:
    return [r.get(key) if isinstance(r.get(key), (int, float)) else None for r in rows]


def _save(fig, run: Run, name: str) -> str:
    fig.tight_layout()
    run.results.mkdir(exist_ok=True)
    fig.savefig(run.results / name, dpi=DPI)
    plt.close(fig)
    return name


def _down_spans(run: Run, device: str) -> list[tuple[float, float]]:
    spans, start = [], None
    for r in run.of("link", device):
        t = r["t"] - run.t0
        if r.get("zenoh_connected") is False and start is None:
            start = t
        elif r.get("zenoh_connected") and start is not None:
            spans.append((start, t))
            start = None
    if start is not None:
        spans.append((start, run.duration_s))
    return spans


def device_figure(run: Run, device: str) -> str | None:
    """Latency, data bandwidth by stream and receive rate, with disconnects shaded."""
    pings, windows, clocks = run.of("ping", device), run.of("window", device), run.of("clock", device)
    if not pings and not windows:
        return None
    rows = 4 if clocks else 3
    fig, axes = plt.subplots(rows, 1, figsize=(11, 2.8 * rows + 0.2), sharex=True)
    fig.suptitle(f"{device} — {run.path.name}")

    ax = axes[0]
    ax.plot(_t(run, pings), _y(pings, "rtt_ms"), lw=1, label="Ping RTT")
    commands = run.of("command", device)
    if commands:
        ax.plot(_t(run, commands), _y(commands, "rtt_ms"), "o", ms=3, label="Command RTT")
    lost = [r["t"] - run.t0 for r in pings if r.get("lost")]
    if lost:
        ax.vlines(lost, 0, 1, transform=ax.get_xaxis_transform(), color=LOST, lw=1, label=f"Ping lost ({len(lost)})")
    ax.set_ylabel("Round trip (ms)")
    ax.legend(loc="upper right", fontsize=8)

    streams = sorted({w["stream"] for w in windows})
    times = sorted({w["t"] for w in windows})
    if streams:
        index = {t: i for i, t in enumerate(times)}
        stacked = []
        for stream in streams:
            series = [0.0] * len(times)
            for w in windows:
                if w["stream"] == stream:
                    series[index[w["t"]]] = w.get("kbps", 0.0)
            stacked.append(series)
        axes[1].stackplot([t - run.t0 for t in times], stacked, labels=streams, alpha=0.85)
        axes[1].legend(loc="upper right", fontsize=8, ncol=min(len(streams), 4))
        for stream in streams:
            rows = [w for w in windows if w["stream"] == stream]
            axes[2].plot(_t(run, rows), _y(rows, "rate_hz"), lw=1, label=stream)
    gaps = [e["t"] - run.t0 for e in run.of("event", device) if e["kind"] == "gap"]
    if gaps:
        axes[2].plot(gaps, [0] * len(gaps), "v", color=LOST, ms=5, label=f"gap ({len(gaps)})")
        axes[2].legend(loc="upper right", fontsize=8)
    axes[1].set_ylabel("Data (kbps)")
    axes[2].set_ylabel("Receive rate (Hz)")
    if clocks:
        offsets = [c["offset_ms"] for c in clocks]
        half_rtt = [c["rtt_ms"] / 2 for c in clocks]
        axes[3].errorbar(_t(run, clocks), offsets, yerr=half_rtt, fmt="o", ms=3, lw=0.8, capsize=0)
        axes[3].axhline(0, color="#9ca3af", lw=0.8)
        axes[3].set_ylabel("Clock offset (ms)")
    axes[-1].set_xlabel("Time since start (s)")
    for i, ax in enumerate(axes):
        for start, end in _down_spans(run, device):
            ax.axvspan(start, end, color=DOWN, zorder=0)
        if i < 3:
            ax.set_ylim(bottom=0)
        ax.grid(alpha=0.3)
    return _save(fig, run, f"device_{device}.png")


def traffic_figure(run: Run) -> str | None:
    """Backend traffic in total, and the data each device sends it."""
    traffic = run["traffic"]
    if not traffic:
        return None
    fig, axes = plt.subplots(2, 1, figsize=(11, 6.5), sharex=True)
    t = _t(run, traffic)
    for key, label in [("rx_kbps", "In"), ("tx_kbps", "Out"), ("ui_kbps", "To browsers")]:
        if nums(traffic, key):
            axes[0].plot(t, _y(traffic, key), lw=1, label=label)
    axes[0].set_ylabel("Backend (kbps)")
    axes[0].set_title(f"Backend traffic ({run.meta.get('traffic_scope', 'host')} network)", loc="left")
    axes[0].legend(loc="upper right", fontsize=8)

    for device in run.devices():
        per_t: dict[float, float] = {}
        for w in run.of("window", device):
            per_t[w["t"]] = per_t.get(w["t"], 0.0) + w.get("kbps", 0.0)
        if per_t:
            times = sorted(per_t)
            axes[1].plot([x - run.t0 for x in times], [per_t[x] for x in times], lw=1, label=device)
    axes[1].set_ylabel("Data from device (kbps)")
    axes[1].set_xlabel("Time since start (s)")
    axes[1].legend(loc="upper right", fontsize=8)
    for ax in axes:
        ax.set_ylim(bottom=0)
        ax.grid(alpha=0.3)
    return _save(fig, run, "traffic.png")


def rtt_cdf(run: Run) -> str | None:
    series = {d: sorted(nums(run.of("ping", d), "rtt_ms")) for d in run.devices()}
    series = {d: v for d, v in series.items() if v}
    if not series:
        return None
    fig, ax = plt.subplots(figsize=(7, 4.5))
    for device, values in series.items():
        ax.plot(values, [(i + 1) / len(values) for i in range(len(values))], label=device)
    ax.set_xscale("log")
    ax.set_xlabel("Ping RTT (ms)")
    ax.set_ylabel("CDF")
    ax.grid(alpha=0.3, which="both")
    ax.legend(fontsize=8)
    return _save(fig, run, "rtt_cdf.png")


def video_figure(run: Run) -> str | None:
    rows = run["video"]
    if not rows:
        return None
    panels = [
        ("bitrate_kbps", "Bitrate (kbps)"), ("fps", "Frame rate (fps)"), ("loss_pct", "Packet loss (%)"),
        ("jitter_ms", "Jitter (ms)"), ("rtt_ms", "RTT (ms)"), ("jitter_buffer_ms", "Jitter buffer (ms)"),
    ]
    fig, axes = plt.subplots(3, 2, figsize=(12, 8), sharex=True)
    for ax, (key, label) in zip(axes.flat, panels, strict=True):
        for device in sorted({r["device_id"] for r in rows}):
            own = run.of("video", device)
            ax.plot(_t(run, own), _y(own, key), lw=1, label=device)
        ax.set_ylabel(label)
        ax.set_ylim(bottom=0)
        ax.grid(alpha=0.3)
    axes[0][0].legend(fontsize=8)
    for ax in axes[-1]:
        ax.set_xlabel("Time since start (s)")
    fig.suptitle("Video (WebRTC, measured in the browser)")
    return _save(fig, run, "video.png")


def coverage_map(run: Run) -> str | None:
    """Robot path colored by its own ping RTT; lost pings as red crosses."""
    poses = run["pose"]
    if not poses:
        return None
    device = poses[0]["device_id"]
    path = [r for r in poses if r["device_id"] == device and isinstance(r.get("x"), float)]
    pings = run.of("ping", device)
    if not path or not pings:
        return None
    times = [r["t"] for r in path]

    def at(t: float) -> dict:
        return path[min(bisect.bisect_left(times, t), len(path) - 1)]

    ok = [(at(p["t"]), p["rtt_ms"]) for p in pings if not p.get("lost") and isinstance(p.get("rtt_ms"), float)]
    lost = [at(p["t"]) for p in pings if p.get("lost")]

    fig, ax = plt.subplots(figsize=(8, 7))
    ax.plot([r["x"] for r in path], [r["y"] for r in path], color="#d1d5db", lw=1, zorder=1)
    if ok:
        sc = ax.scatter([p["x"] for p, _ in ok], [p["y"] for p, _ in ok], c=[v for _, v in ok], cmap="viridis_r",
                        s=14, zorder=2)
        fig.colorbar(sc, ax=ax, label="Ping RTT (ms)")
    if lost:
        ax.scatter([p["x"] for p in lost], [p["y"] for p in lost], marker="x", color=LOST, s=30, zorder=3,
                   label=f"lost ({len(lost)})")
        ax.legend(fontsize=8)
    ax.set_aspect("equal")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.set_title(f"{device} link quality along the route")
    ax.grid(alpha=0.3)
    return _save(fig, run, "coverage.png")
