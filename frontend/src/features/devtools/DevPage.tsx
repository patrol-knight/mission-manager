import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { useRealtimeSubscription } from "../../hooks/useRealtimeSubscription";
import { useNow } from "../../hooks/useNow";
import { useDeviceStore } from "../../stores/deviceStore";
import { devApi, type RunSummary } from "./devApi";
import { connectDevSocket, type BrowserRowsProvider } from "./devSocket";
import { useDevStore } from "./devStore";
import { DeviceCard } from "./DeviceCard";
import { fmt, percentile, recent } from "./metrics";
import { WebrtcPanel } from "./WebrtcPanel";
import styles from "./DevPage.module.css";

type Tab = "live" | "runs";

function duration(fromIso: string | null, toMs: number): string {
  if (!fromIso) return "";
  const sec = Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function RecordBar() {
  const status = useDevStore((s) => s.status);
  const now = useNow(1000);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recording = status?.recording ?? null;

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`${styles.recordBar} ${recording ? styles.recordBarActive : ""}`}>
      {recording ? (
        <>
          <span className={styles.recDot} />
          <strong>Recording</strong>
          <span className={styles.mono}>data/runs/{recording}</span>
          <span className={styles.muted}>{duration(status?.started_at ?? null, now)}</span>
          <span className={styles.grow} />
          <Button variant="dangerSolid" disabled={busy} onClick={() => run(devApi.stopRun)}>
            Stop recording
          </Button>
        </>
      ) : (
        <>
          <input
            className={`${styles.input} ${styles.labelInput}`}
            placeholder="Run label, e.g. tower-2 at 40 m, robot loop"
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button variant="primary" disabled={busy} onClick={() => run(() => devApi.startRun(label.trim(), ""))}>
            Record
          </Button>
          <span className={styles.muted}>
            Saves every 1 s window, ping, WebRTC stats and robot pose until stopped.
          </span>
        </>
      )}
      {error && <span className={styles.bad}>{error}</span>}
    </div>
  );
}

function LiveView({ registerProvider }: { registerProvider: (p: BrowserRowsProvider | null) => void }) {
  const links = useDevStore((s) => s.links);
  const streams = useDevStore((s) => s.streams);
  const pings = useDevStore((s) => s.pings);
  const status = useDevStore((s) => s.status);
  const devices = useDeviceStore((s) => s.devices);

  const deviceIds = useMemo(() => {
    const ids = new Set([...links.map((l) => l.device_id), ...Object.keys(pings), ...Object.keys(devices)]);
    Object.keys(streams).forEach((key) => ids.add(key.split("|")[0]));
    return [...ids].sort();
  }, [links, pings, devices, streams]);

  return (
    <>
      {status?.ping_error && <span className={styles.bad}>Ping failed: {status.ping_error}</span>}
      {deviceIds.length === 0 && <div className={`${styles.card} ${styles.empty}`}>Waiting for devices…</div>}
      {deviceIds.map((id) => (
        <DeviceCard
          key={id}
          deviceId={id}
          type={devices[id]?.type ?? null}
          link={links.find((l) => l.device_id === id)}
          manualIp={status?.manual_ips[id]}
          pings={pings[id] ?? []}
          streams={Object.entries(streams)
            .filter(([key]) => key.startsWith(`${id}|`))
            .map(([key, history]) => [key.split("|")[1], history])}
        />
      ))}
      <WebrtcPanel registerProvider={registerProvider} />
    </>
  );
}

function RunsView() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const recording = useDevStore((s) => s.status?.recording ?? null);

  useEffect(() => {
    devApi.listRuns().then(setRuns).catch(() => setRuns([]));
  }, [recording]);

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>Runs</h3>
      {runs === null ? (
        <span className={styles.muted}>Loading…</span>
      ) : runs.length === 0 ? (
        <span className={styles.muted}>No runs recorded yet.</span>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Run</th>
              <th style={{ textAlign: "left" }}>Label</th>
              <th>Started</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td className={styles.mono}>{r.run_id}</td>
                <td style={{ textAlign: "left" }}>{r.label || <span className={styles.faint}>–</span>}</td>
                <td>{r.started_at ? new Date(r.started_at).toLocaleString() : "–"}</td>
                <td>{r.ended_at ? duration(r.started_at, Date.parse(r.ended_at)) : "recording"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className={styles.note}>
        Plots: <span className={styles.mono}>python -m scripts.analyzer data/runs/&lt;run&gt;</span>
      </span>
    </section>
  );
}

export function DevPage() {
  useRealtimeSubscription();
  const [tab, setTab] = useState<Tab>("live");
  const connected = useDevStore((s) => s.connected);
  const wsRtt = useDevStore((s) => s.wsRtt);
  const providerRef = useRef<BrowserRowsProvider | null>(null);

  useEffect(() => connectDevSocket(() => providerRef.current), []);

  const rtt = recent(wsRtt, 60).map((r) => r.value);
  const registerProvider = (provider: BrowserRowsProvider | null) => {
    providerRef.current = provider;
  };

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandName}>Mission Manager</span>
          <span className={styles.brandSub}>devtools</span>
        </div>
        <nav className={styles.tabs}>
          {(["live", "runs"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "live" ? "Live" : "Runs"}
            </button>
          ))}
        </nav>
        <div className={styles.status}>
          <span className={styles.statusItem}>
            <StatusDot status={connected ? "online" : "offline"} size={7} />
            {connected ? "Backend" : "Backend offline"}
          </span>
          <span className={styles.statusItem}>
            WebSocket RTT {fmt(rtt[rtt.length - 1])} ms · p95 {fmt(percentile(rtt, 95))} ms
          </span>
        </div>
      </header>
      <main className={styles.main}>
        <RecordBar />
        {tab === "live" ? <LiveView registerProvider={registerProvider} /> : <RunsView />}
      </main>
    </div>
  );
}
