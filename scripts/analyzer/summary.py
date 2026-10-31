import statistics

from .reader import Run


def pct(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(p / 100 * len(ordered) + 0.5) - 1))]


def _num(rows: list[dict], key: str) -> list[float]:
    return [r[key] for r in rows if isinstance(r.get(key), float)]


def _f(value, digits=1) -> str:
    return "–" if value is None else f"{value:.{digits}f}"


def device_summary(run: Run, device: str) -> dict:
    pings = [r for r in run["ping"] if r["device_id"] == device]
    rtts = _num(pings, "rtt_ms")
    links = [r for r in run["links"] if r["device_id"] == device]
    return {
        "device": device,
        "ip": next((r["ip"] for r in reversed(pings) if r.get("ip")), None),
        "pings": len(pings),
        "loss_pct": 100 * sum(1 for r in pings if r["lost"]) / len(pings) if pings else None,
        "rtt_p50": pct(rtts, 50),
        "rtt_p95": pct(rtts, 95),
        "rtt_p99": pct(rtts, 99),
        "rtt_max": max(rtts) if rtts else None,
        "zenoh_down_s": sum(1 for r in links if r.get("zenoh_connected") is False),
        "reconnects": int(max(_num(links, "reconnects"), default=0)),
    }


def stream_summaries(run: Run, device: str) -> list[dict]:
    rows = [r for r in run["windows"] if r["device_id"] == device]
    samples = [r for r in run["samples"] if r["device_id"] == device]
    out = []
    for stream in sorted({r["stream"] for r in rows}):
        w = [r for r in rows if r["stream"] == stream]
        count = sum(_num(w, "count"))
        expected = statistics.median(_num(w, "expected_hz")) if _num(w, "expected_hz") else None
        active = [i for i, r in enumerate(w) if r.get("count")]
        active_w = w[active[0] : active[-1] + 1] if active else []
        span = sum(_num(active_w, "window_s"))
        rate = sum(_num(active_w, "count")) / span if span else None
        latencies = _num([s for s in samples if s["stream"] == stream], "latency_ms")
        out.append({
            "stream": stream,
            "seconds": len(w),
            "samples": int(count),
            "rate_hz": rate,
            "expected_hz": expected,
            "delivery_pct": 100 * rate / expected if rate and expected else None,
            "jitter_p95_ms": pct(_num(w, "jitter_ms"), 95),
            "interval_max_ms": max(_num(w, "interval_ms_max"), default=None),
            "gaps": int(sum(_num(w, "gaps"))),
            "gap_max_ms": max(_num(w, "gap_ms_max"), default=None),
            "kbps_mean": statistics.fmean(_num(w, "kbps")) if w else None,
            "latency_p50_ms": pct(latencies, 50),
            "latency_p95_ms": pct(latencies, 95),
        })
    return out


def webrtc_summary(run: Run) -> list[dict]:
    out = []
    for device in sorted({r["device_id"] for r in run["webrtc"]}):
        rows = [r for r in run["webrtc"] if r["device_id"] == device and r.get("state") == "connected"]
        if not rows:
            continue
        out.append({
            "device": device,
            "seconds": len(rows),
            "bitrate_kbps": statistics.fmean(_num(rows, "bitrate_kbps") or [0]),
            "fps_mean": statistics.fmean(_num(rows, "fps") or [0]),
            "fps_min": min(_num(rows, "fps"), default=None),
            "loss_pct_mean": statistics.fmean(_num(rows, "loss_pct") or [0]),
            "loss_pct_max": max(_num(rows, "loss_pct"), default=None),
            "jitter_p95_ms": pct(_num(rows, "jitter_ms"), 95),
            "rtt_p95_ms": pct(_num(rows, "rtt_ms"), 95),
            "jitter_buffer_ms": statistics.fmean(_num(rows, "jitter_buffer_ms") or [0]),
            "freezes": int(max(_num(rows, "freeze_count"), default=0)),
            "freeze_s": max(_num(rows, "freeze_s"), default=0.0),
        })
    return out


def _table(headers: list[str], rows: list[list[str]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(lines)


def write_summary(run: Run) -> str:
    meta = run.meta
    parts = [
        f"# Run {run.path.name}",
        "",
        f"- Label: {meta.get('label') or '–'}",
        f"- Started: {meta.get('started_at')}",
        f"- Ended: {meta.get('ended_at')}",
        "",
        "## Devices",
        "",
        _table(
            ["Device", "IP", "Pings", "Loss %", "RTT p50", "p95", "p99", "max (ms)", "Zenoh down (s)", "Reconnects"],
            [
                [d["device"], str(d["ip"] or "–"), str(d["pings"]), _f(d["loss_pct"], 2), _f(d["rtt_p50"]),
                 _f(d["rtt_p95"]), _f(d["rtt_p99"]), _f(d["rtt_max"]), str(d["zenoh_down_s"]), str(d["reconnects"])]
                for d in (device_summary(run, dev) for dev in run.devices())
            ],
        ),
        "",
        "## Streams",
        "",
        "Delivery = measured rate / expected rate (median interval), between the first and last sample. Latency is receive time minus payload timestamp "
        "and only meaningful with synced clocks.",
        "",
    ]
    stream_rows = []
    for device in run.devices():
        for s in stream_summaries(run, device):
            stream_rows.append([
                device, s["stream"], str(s["seconds"]), _f(s["rate_hz"]), _f(s["expected_hz"]), _f(s["delivery_pct"]),
                _f(s["jitter_p95_ms"]), _f(s["interval_max_ms"], 0), str(s["gaps"]), _f(s["gap_max_ms"], 0),
                _f(s["kbps_mean"]), _f(s["latency_p50_ms"], 0), _f(s["latency_p95_ms"], 0),
            ])
    parts.append(_table(
        ["Device", "Stream", "s", "Rate", "Expected", "Delivery %", "Jitter p95", "Max interval", "Gaps",
         "Max gap (ms)", "kbps", "Latency p50", "p95"],
        stream_rows,
    ))
    webrtc = webrtc_summary(run)
    if webrtc:
        parts += ["", "## WebRTC", "", _table(
            ["Device", "s", "kbps", "fps", "fps min", "Loss % mean", "max", "Jitter p95", "RTT p95", "Buffer (ms)",
             "Freezes", "Frozen (s)"],
            [
                [w["device"], str(w["seconds"]), _f(w["bitrate_kbps"], 0), _f(w["fps_mean"]), _f(w["fps_min"], 0),
                 _f(w["loss_pct_mean"], 2), _f(w["loss_pct_max"], 2), _f(w["jitter_p95_ms"]), _f(w["rtt_p95_ms"]),
                 _f(w["jitter_buffer_ms"], 0), str(w["freezes"]), _f(w["freeze_s"])]
                for w in webrtc
            ],
        )]
    ws = _num(run["ws"], "rtt_ms")
    if ws:
        parts += ["", "## Backend → browser", "", f"WebSocket RTT p50 {_f(pct(ws, 50))} ms, p95 {_f(pct(ws, 95))} ms."]
    text = "\n".join(parts) + "\n"
    (run.path / "summary.md").write_text(text)
    return text
