import csv
import statistics
from collections import defaultdict

from .reader import Run

COLUMNS = [
    "device", "ip", "duration_s", "online_pct", "disconnects", "downtime_s", "reconnects",
    "rtt_p50_ms", "rtt_p95_ms", "rtt_p99_ms", "rtt_max_ms", "ping_loss_pct",
    "command_rtt_p50_ms", "command_rtt_p95_ms", "commands",
    "clock_offset_ms", "clock_uncertainty_ms", "state_latency_p50_ms", "state_latency_p95_ms",
    "data_kbps_mean", "data_kbps_peak", "gaps",
    "video_kbps_mean", "video_fps_mean", "video_loss_pct", "video_freeze_s",
    "in_kbps_mean", "in_kbps_peak", "out_kbps_mean", "out_kbps_peak", "ui_kbps_mean",
]


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(p / 100 * len(ordered) + 0.5) - 1))]


def nums(rows: list[dict], key: str) -> list[float]:
    return [r[key] for r in rows if isinstance(r.get(key), (int, float)) and not isinstance(r.get(key), bool)]


def mean(values: list[float]) -> float | None:
    return statistics.fmean(values) if values else None


def data_kbps(run: Run, device: str) -> list[float]:
    """Sum over the device's streams, per 1 s window."""
    per_t: dict[float, float] = defaultdict(float)
    for w in run.of("window", device):
        per_t[w["t"]] += w.get("kbps", 0.0)
    return list(per_t.values())


def clock_offset(run: Run, device: str) -> tuple[float, float] | None:
    """(offset, uncertainty) in ms: device clock minus the backend's, from the
    time probes with the shortest round trips (each is good to ±RTT/2)."""
    probes = [c for c in run.of("clock", device) if isinstance(c.get("offset_ms"), (int, float))]
    if not probes:
        return None
    cutoff = pct([c["rtt_ms"] for c in probes], 25)
    best = [c for c in probes if c["rtt_ms"] <= cutoff]
    return statistics.median(c["offset_ms"] for c in best), statistics.median(c["rtt_ms"] for c in best) / 2


def device_row(run: Run, device: str) -> dict:
    pings = run.of("ping", device)
    rtts = nums(pings, "rtt_ms")
    links = [r for r in run.of("link", device) if "zenoh_connected" in r]
    events = run.of("event", device)
    commands = nums(run.of("command", device), "rtt_ms")
    kbps = data_kbps(run, device)
    video = run.of("video", device)
    clock = clock_offset(run, device)
    # Raw latency is receive time minus a device timestamp, so it is off by -offset.
    state = [w["latency_ms_p50"] + clock[0] for w in run.of("window", device)
             if clock and w["stream"] == "state" and isinstance(w.get("latency_ms_p50"), (int, float))]
    return {
        "device": device,
        "ip": (run.end.get("devices") or run.meta.get("devices") or {}).get(device),
        "duration_s": run.duration_s,
        "online_pct": 100 * sum(1 for r in links if r["zenoh_connected"]) / len(links) if links else None,
        "disconnects": sum(1 for e in events if e["kind"] == "disconnect"),
        "downtime_s": sum(e.get("downtime_s", 0.0) for e in events if e["kind"] == "reconnect"),
        "reconnects": max((r.get("reconnects", 0) for r in links), default=0),
        "rtt_p50_ms": pct(rtts, 50),
        "rtt_p95_ms": pct(rtts, 95),
        "rtt_p99_ms": pct(rtts, 99),
        "rtt_max_ms": max(rtts, default=None),
        "ping_loss_pct": 100 * sum(1 for r in pings if r.get("lost")) / len(pings) if pings else None,
        "command_rtt_p50_ms": pct(commands, 50),
        "command_rtt_p95_ms": pct(commands, 95),
        "commands": len(commands),
        "clock_offset_ms": clock[0] if clock else None,
        "clock_uncertainty_ms": clock[1] if clock else None,
        "state_latency_p50_ms": pct(state, 50),
        "state_latency_p95_ms": pct(state, 95),
        "data_kbps_mean": mean(kbps),
        "data_kbps_peak": max(kbps, default=None),
        "gaps": sum(1 for e in events if e["kind"] == "gap"),
        "video_kbps_mean": mean(nums(video, "bitrate_kbps")),
        "video_fps_mean": mean(nums(video, "fps")),
        "video_loss_pct": mean(nums(video, "loss_pct")),
        "video_freeze_s": max(nums(video, "freeze_s"), default=None),
    }


def backend_row(run: Run) -> dict:
    traffic = run["traffic"]
    rx, tx = nums(traffic, "rx_kbps"), nums(traffic, "tx_kbps")
    return {
        "device": "backend",
        "duration_s": run.duration_s,
        "in_kbps_mean": mean(rx),
        "in_kbps_peak": max(rx, default=None),
        "out_kbps_mean": mean(tx),
        "out_kbps_peak": max(tx, default=None),
        "ui_kbps_mean": mean(nums(traffic, "ui_kbps")),
    }


def write_summary(run: Run) -> str:
    """One row per device plus a "backend" row, in results/summary.csv."""
    run.results.mkdir(exist_ok=True)
    path = run.results / "summary.csv"
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        for row in [device_row(run, d) for d in run.devices()] + [backend_row(run)]:
            writer.writerow({k: round(v, 2) if isinstance(v, float) else v for k, v in row.items()})
    return path.name
