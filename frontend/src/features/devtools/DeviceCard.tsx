import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { Pill } from "../../components/ui/Pill";
import { devApi } from "./devApi";
import type { DeviceLink, PingResult, StreamWindow, Timed } from "./devStore";
import { fmt, lossLevel, recent, rttLevel, silentLevel, summarizePings, type Level } from "./metrics";
import { Sparkline } from "./Sparkline";
import styles from "./DevPage.module.css";

const SPARK_SEC = 120;

interface DeviceCardProps {
  deviceId: string;
  type: string | null;
  link: DeviceLink | undefined;
  manualIp: string | undefined;
  pings: PingResult[];
  streams: [string, Timed<StreamWindow>[]][];
}

export function Kpi({ label, value, unit, level, children }: {
  label: string;
  value: string;
  unit?: string;
  level?: Level;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${level ? styles[level] : ""}`}>
        {value}
        {unit && value !== "–" && <span className={styles.kpiUnit}>{unit}</span>}
      </span>
      {children}
    </div>
  );
}

function IpEditor({ deviceId, ip, manualIp }: { deviceId: string; ip: string | null; manualIp: string | undefined }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(manualIp ?? ip ?? "");

  if (!editing) {
    return (
      <span className={styles.ipEdit}>
        <span className={styles.mono}>{manualIp ?? ip ?? "no IP"}</span>
        {manualIp && <Pill tone="subtle">manual</Pill>}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Set IP
        </Button>
      </span>
    );
  }
  const save = (next: string | null) => {
    devApi.setTarget(deviceId, next).finally(() => setEditing(false));
  };
  return (
    <span className={styles.ipEdit}>
      <input
        className={`${styles.input} ${styles.mono}`}
        value={value}
        placeholder="192.168.1.20"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save(value.trim() || null)}
        autoFocus
      />
      <Button size="sm" variant="primary" onClick={() => save(value.trim() || null)}>
        Save
      </Button>
      {manualIp && (
        <Button size="sm" variant="ghost" onClick={() => save(null)}>
          Auto
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </span>
  );
}

export function DeviceCard({ deviceId, type, link, manualIp, pings, streams }: DeviceCardProps) {
  const ping = summarizePings(pings);
  const sparkPings = recent(pings, SPARK_SEC);
  const connected = link?.zenoh_connected ?? false;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <StatusDot status={link ? (connected ? "online" : "offline") : "unknown"} />
        <h3 className={styles.cardTitle}>{deviceId}</h3>
        {type && <Pill tone="subtle">{type}</Pill>}
        <span className={styles.grow} />
        <IpEditor key={manualIp ?? link?.ip ?? ""} deviceId={deviceId} ip={link?.ip ?? null} manualIp={manualIp} />
      </div>

      <div className={styles.kpis}>
        <Kpi label="Ping RTT (last)" value={fmt(ping.last)} unit="ms" level={rttLevel(ping.last)}>
          <Sparkline values={sparkPings.map((p) => p.rtt_ms)} marks={sparkPings.map((p) => p.lost)} />
        </Kpi>
        <Kpi label="RTT p50 / p95 (60 s)" value={`${fmt(ping.p50)} / ${fmt(ping.p95)}`} unit="ms" level={rttLevel(ping.p95)} />
        <Kpi label={`Ping loss (${ping.sent} sent)`} value={fmt(ping.lossPct)} unit="%" level={lossLevel(ping.lossPct)} />
        <Kpi
          label="Zenoh session"
          value={link ? (connected ? "Connected" : "Lost") : "–"}
          level={link ? (connected ? "ok" : "bad") : "idle"}
        >
          <span className={styles.muted}>{link ? `${link.reconnects} reconnects` : "not seen on the router"}</span>
        </Kpi>
      </div>

      {streams.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Stream</th>
                <th>Rate (Hz)</th>
                <th>Expected</th>
                <th>Jitter (ms)</th>
                <th>Max interval (ms)</th>
                <th>Gaps</th>
                <th>Bandwidth (kbps)</th>
                <th>Payload (KB)</th>
                <th>Latency* (ms)</th>
                <th>Silent (s)</th>
                <th>Rate, last 2 min</th>
              </tr>
            </thead>
            <tbody>
              {streams.map(([stream, history]) => {
                const w = history[history.length - 1].value;
                const spark = recent(history, SPARK_SEC);
                return (
                  <tr key={stream}>
                    <td>{stream}</td>
                    <td>{fmt(w.rate_hz)}</td>
                    <td className={styles.faint}>{fmt(w.expected_hz)}</td>
                    <td>{fmt(w.jitter_ms)}</td>
                    <td>{fmt(w.interval_ms_max, 0)}</td>
                    <td className={w.total_gaps ? styles.warn : undefined}>{w.total_gaps}</td>
                    <td>{fmt(w.kbps)}</td>
                    <td>{fmt(w.payload_kb_mean, 2)}</td>
                    <td className={styles.faint}>{fmt(w.latency_ms_p50, 0)}</td>
                    <td className={styles[silentLevel(w.silent_s, w.expected_hz)]}>{fmt(w.silent_s)}</td>
                    <td>
                      <Sparkline values={spark.map((h) => h.value.rate_hz)} width={120} height={20} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.note}>
            * Receive time minus the payload timestamp. Only meaningful once device and server clocks are synced.
          </p>
        </div>
      )}
    </section>
  );
}
