import bisect

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from .reader import Run  # noqa: E402

LOST = "#c51e3a"
DPI = 150


def _xy(run: Run, rows: list[dict], key: str) -> tuple[list[float], list[float | None]]:
    return [r["t"] - run.t0 for r in rows], [r.get(key) if isinstance(r.get(key), float) else None for r in rows]


def _save(fig, run: Run, name: str) -> str:
    fig.tight_layout()
    path = run.path / name
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    return path.name


def device_figure(run: Run, device: str) -> str | None:
    pings = [r for r in run["ping"] if r["device_id"] == device]
    windows = [r for r in run["windows"] if r["device_id"] == device]
    if not pings and not windows:
        return None
    fig, axes = plt.subplots(4, 1, figsize=(11, 10), sharex=True)
    fig.suptitle(f"{device} — {run.meta.get('label') or run.path.name}")

    ax = axes[0]
    t, rtt = _xy(run, pings, "rtt_ms")
    ax.plot(t, rtt, lw=1, label="RTT")
    lost = [r["t"] - run.t0 for r in pings if r["lost"]]
    if lost:
        ax.vlines(lost, 0, 1, transform=ax.get_xaxis_transform(), color=LOST, lw=1, label=f"lost ({len(lost)})")
    ax.set_ylabel("Ping RTT (ms)")
    ax.legend(loc="upper right", fontsize=8)

    streams = sorted({r["stream"] for r in windows})
    for stream in streams:
        rows = [r for r in windows if r["stream"] == stream]
        t, rate = _xy(run, rows, "rate_hz")
        axes[1].plot(t, rate, lw=1, label=stream)
        t, jitter = _xy(run, rows, "jitter_ms")
        axes[2].plot(t, jitter, lw=1, label=stream)
        t, kbps = _xy(run, rows, "kbps")
        axes[3].plot(t, kbps, lw=1, label=stream)
        gaps = [r["t"] - run.t0 for r in rows if (r.get("gaps") or 0) > 0]
        if gaps:
            axes[1].plot(gaps, [0] * len(gaps), "v", color=LOST, ms=5)
    axes[1].set_ylabel("Rate (Hz)")
    axes[2].set_ylabel("Inter-arrival jitter (ms)")
    axes[3].set_ylabel("Bandwidth (kbps)")
    axes[3].set_xlabel("Time since start (s)")
    if streams:
        axes[1].legend(loc="upper right", fontsize=8, ncol=min(len(streams), 4))
    for ax in axes:
        ax.grid(alpha=0.3)
    return _save(fig, run, f"device_{device}.png")


def ping_cdf(run: Run) -> str | None:
    devices = run.devices()
    series = {d: sorted(r["rtt_ms"] for r in run["ping"] if r["device_id"] == d and isinstance(r["rtt_ms"], float))
              for d in devices}
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
    return _save(fig, run, "ping_cdf.png")


def webrtc_figure(run: Run) -> str | None:
    rows = run["webrtc"]
    if not rows:
        return None
    panels = [
        ("bitrate_kbps", "Bitrate (kbps)"), ("fps", "Frame rate (fps)"), ("loss_pct", "Packet loss (%)"),
        ("jitter_ms", "Jitter (ms)"), ("rtt_ms", "RTT (ms)"), ("jitter_buffer_ms", "Jitter buffer (ms)"),
    ]
    fig, axes = plt.subplots(3, 2, figsize=(12, 8), sharex=True)
    for ax, (key, label) in zip(axes.flat, panels, strict=True):
        for device in sorted({r["device_id"] for r in rows}):
            t, y = _xy(run, [r for r in rows if r["device_id"] == device], key)
            ax.plot(t, y, lw=1, label=device)
        ax.set_ylabel(label)
        ax.set_ylim(bottom=0)
        ax.grid(alpha=0.3)
    axes[0][0].legend(fontsize=8)
    for ax in axes[-1]:
        ax.set_xlabel("Time since start (s)")
    fig.suptitle("WebRTC")
    return _save(fig, run, "webrtc.png")


def coverage_map(run: Run) -> str | None:
    """Robot path colored by its own ping RTT; lost pings as red crosses."""
    robot = run["robot"]
    if not robot:
        return None
    device = robot[0]["device_id"]
    path = [r for r in robot if r["device_id"] == device and isinstance(r.get("x"), float)]
    pings = [r for r in run["ping"] if r["device_id"] == device]
    if not path or not pings:
        return None
    times = [r["t"] for r in path]

    def at(t: float) -> dict:
        i = min(max(bisect.bisect_left(times, t), 0), len(path) - 1)
        return path[i]

    ok = [(at(p["t"]), p["rtt_ms"]) for p in pings if not p["lost"] and isinstance(p["rtt_ms"], float)]
    lost = [at(p["t"]) for p in pings if p["lost"]]

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
