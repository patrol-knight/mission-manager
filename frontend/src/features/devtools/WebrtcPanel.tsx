import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Pill } from "../../components/ui/Pill";
import { describeCameraSessionError, startWebrtcSession, type WebrtcSession } from "../../api/webrtcClient";
import { useDeviceStore } from "../../stores/deviceStore";
import type { BrowserRowsProvider } from "./devSocket";
import { Kpi } from "./DeviceCard";
import { fmt, lossLevel, rttLevel } from "./metrics";
import { Sparkline } from "./Sparkline";
import { WebrtcStatsSampler, type WebrtcRow } from "./webrtcStats";
import styles from "./DevPage.module.css";

const HISTORY = 120;

interface WebrtcPanelProps {
  registerProvider: (provider: BrowserRowsProvider | null) => void;
}

export function WebrtcPanel({ registerProvider }: WebrtcPanelProps) {
  const devices = useDeviceStore((s) => s.devices);
  const cameras = useDeviceStore((s) => s.cameras);
  const [deviceId, setDeviceId] = useState("");
  const [running, setRunning] = useState(false);
  const [state, setState] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WebrtcRow[]>([]);
  const [setupMs, setSetupMs] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WebrtcSession | null>(null);

  const options = Object.keys(cameras).length ? Object.keys(cameras) : Object.keys(devices);
  const selected = deviceId || options[0] || "";

  useEffect(() => {
    if (!running || !selected) return;
    const video = videoRef.current;
    let cancelled = false;
    let connState = "starting";
    let pending: WebrtcRow[] = [];
    const sampler = new WebrtcStatsSampler(selected);
    const startedAt = performance.now();
    let firstFrame = false;
    setRows([]);
    setSetupMs(null);
    setError(null);
    setState(connState);

    startWebrtcSession(selected, cameras[selected]?.cameraId ?? "front", {
      onTrack: (stream) => {
        if (video) video.srcObject = stream;
      },
      onConnectionStateChange: (next) => {
        connState = next;
        setState(next);
      },
      onEnded: (reason) => {
        if (cancelled) return;
        setError(describeCameraSessionError(reason));
        setRunning(false);
      },
    })
      .then((session) => {
        if (cancelled) session.stop();
        else sessionRef.current = session;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(describeCameraSessionError(err));
        setRunning(false);
      });

    const timer = setInterval(async () => {
      const session = sessionRef.current;
      if (!session) return;
      const row = sampler.sample(await session.getStats(), connState);
      if (!firstFrame && (row.frames_decoded ?? 0) > 0) {
        firstFrame = true;
        setSetupMs(performance.now() - startedAt);
      }
      pending.push(row);
      setRows((prev) => [...prev.slice(-(HISTORY - 1)), row]);
    }, 1000);

    registerProvider(async () => {
      const out = pending;
      pending = [];
      return out as unknown as Record<string, unknown>[];
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      registerProvider(null);
      sessionRef.current?.stop();
      sessionRef.current = null;
      if (video) video.srcObject = null;
      setState("idle");
    };
    // The session is restarted only by Start/Stop or a new device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, selected]);

  const last = rows[rows.length - 1];
  const series = (key: keyof WebrtcRow) => rows.map((r) => r[key] as number | null);

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>WebRTC</h3>
        <Pill tone={state === "connected" ? "success" : state === "idle" ? "subtle" : "warning"} dot>
          {state}
        </Pill>
        <span className={styles.grow} />
        <select
          className={styles.input}
          value={selected}
          disabled={running}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          {options.length === 0 && <option value="">No devices</option>}
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        {running ? (
          <Button variant="danger" onClick={() => setRunning(false)}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" disabled={!selected} onClick={() => setRunning(true)}>
            Start
          </Button>
        )}
      </div>
      {error && <span className={styles.bad}>{error}</span>}

      <div className={styles.webrtcBody}>
        <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
        <div className={styles.kpis}>
          <Kpi label="Bitrate" value={fmt(last?.bitrate_kbps, 0)} unit="kbps">
            <Sparkline values={series("bitrate_kbps")} />
          </Kpi>
          <Kpi label="Frame rate" value={fmt(last?.fps, 0)} unit="fps">
            <Sparkline values={series("fps")} />
          </Kpi>
          <Kpi label="Packet loss (1 s)" value={fmt(last?.loss_pct, 2)} unit="%" level={lossLevel(last?.loss_pct ?? null)}>
            <Sparkline values={series("loss_pct")} color="var(--color-danger)" />
          </Kpi>
          <Kpi label="Jitter" value={fmt(last?.jitter_ms)} unit="ms">
            <Sparkline values={series("jitter_ms")} />
          </Kpi>
          <Kpi label="RTT" value={fmt(last?.rtt_ms)} unit="ms" level={rttLevel(last?.rtt_ms ?? null)}>
            <Sparkline values={series("rtt_ms")} />
          </Kpi>
          <Kpi label="Jitter buffer" value={fmt(last?.jitter_buffer_ms, 0)} unit="ms">
            <Sparkline values={series("jitter_buffer_ms")} />
          </Kpi>
          <Kpi label="Freezes" value={last ? `${last.freeze_count ?? 0}` : "–"}>
            <span className={styles.muted}>{fmt(last?.freeze_s)} s frozen</span>
          </Kpi>
          <Kpi label="Lost / received packets" value={last ? `${last.packets_lost ?? 0}` : "–"}>
            <span className={styles.muted}>of {last?.packets_received ?? "–"}</span>
          </Kpi>
          <Kpi label="Dropped frames" value={last ? `${last.frames_dropped ?? 0}` : "–"}>
            <span className={styles.muted}>of {last?.frames_decoded ?? "–"} decoded</span>
          </Kpi>
          <Kpi label="NACK / PLI" value={last ? `${last.nack_count ?? 0} / ${last.pli_count ?? 0}` : "–"} />
          <Kpi label="Time to first frame" value={setupMs !== null ? fmt(setupMs / 1000, 2) : "–"} unit="s" />
          <Kpi label="Resolution" value={last?.width ? `${last.width}×${last.height}` : "–"}>
            <span className={styles.muted}>est. capacity {fmt(last?.available_kbps, 0)} kbps</span>
          </Kpi>
        </div>
      </div>
      {last?.remote_candidate && (
        <span className={styles.note}>
          ICE pair: {last.local_candidate} ⇄ {last.remote_candidate}
        </span>
      )}
    </section>
  );
}
