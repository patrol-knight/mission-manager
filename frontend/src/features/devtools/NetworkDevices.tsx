import { Fragment, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Pill } from "../../components/ui/Pill";
import { StatusDot } from "../../components/ui/StatusDot";
import { useDeviceStore } from "../../stores/deviceStore";
import { devApi } from "./devApi";
import { useDevStore, type LinkEvent, type StreamWindow, type Timed } from "./devStore";
import { Kpi } from "./Kpi";
import { bestClock, fmt, lossLevel, offsetLevel, recent, rttLevel, silentLevel, summarizePings } from "./metrics";
import { Sparkline } from "./Sparkline";
import styles from "./DevPage.module.css";

const SPARK_SEC = 120;

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

function StreamTable({ streams, offset }: { streams: [string, Timed<StreamWindow>[]][]; offset: number | null }) {
  if (!streams.length) return <span className={styles.muted}>No data received yet.</span>;
  return (
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
                <td className={offset === null ? styles.faint : undefined}>
                  {fmt(w.latency_ms_p50 === null ? null : w.latency_ms_p50 + (offset ?? 0), 0)}
                </td>
                <td className={styles[silentLevel(w.silent_s, w.expected_hz)]}>{fmt(w.silent_s)}</td>
                <td>
                  <Sparkline values={recent(history, SPARK_SEC).map((h) => h.value.rate_hz)} width={120} height={20} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.note}>
        * Receive time minus the payload timestamp
        {offset === null
          ? ", uncorrected: no clock offset measured yet."
          : `, corrected by the measured clock offset (${fmt(offset)} ms). Skeleton is stamped at capture, so it includes inference.`}
      </p>
    </div>
  );
}

function describe(event: LinkEvent): string {
  if (event.kind === "disconnect") return "Zenoh session lost";
  if (event.kind === "reconnect") {
    return event.downtime_s ? `Reconnected after ${fmt(event.downtime_s)} s` : "Reconnected (new session)";
  }
  return `Gap of ${fmt(event.gap_ms, 0)} ms on ${event.stream}`;
}

function TrafficCard({ online, total }: { online: number; total: number }) {
  const traffic = useDevStore((s) => s.traffic);
  const spark = recent(traffic, SPARK_SEC);
  const last = traffic[traffic.length - 1]?.value;
  return (
    <section className={styles.card}>
      <div className={styles.kpis}>
        <Kpi label="Devices online" value={total ? `${online} / ${total}` : "–"} level={total ? (online < total ? "warn" : "ok") : undefined} />
        <Kpi label="Backend in" value={fmt(last?.rx_kbps)} unit="kbps">
          <Sparkline values={spark.map((h) => h.value.rx_kbps ?? null)} />
        </Kpi>
        <Kpi label="Backend out" value={fmt(last?.tx_kbps)} unit="kbps">
          <Sparkline values={spark.map((h) => h.value.tx_kbps ?? null)} />
        </Kpi>
        <Kpi label="To browsers" value={fmt(last?.ui_kbps)} unit="kbps">
          <Sparkline values={spark.map((h) => h.value.ui_kbps)} />
        </Kpi>
      </div>
    </section>
  );
}

export function NetworkDevices() {
  const links = useDevStore((s) => s.links);
  const streams = useDevStore((s) => s.streams);
  const pings = useDevStore((s) => s.pings);
  const commands = useDevStore((s) => s.commands);
  const clocks = useDevStore((s) => s.clocks);
  const events = useDevStore((s) => s.events);
  const status = useDevStore((s) => s.status);
  const devices = useDeviceStore((s) => s.devices);
  const [open, setOpen] = useState<string | null>(null);

  const deviceIds = useMemo(() => {
    const ids = new Set([...links.map((l) => l.device_id), ...Object.keys(pings), ...Object.keys(devices)]);
    Object.keys(streams).forEach((key) => ids.add(key.split("|")[0]));
    return [...ids].sort();
  }, [links, pings, devices, streams]);

  const rows = deviceIds.map((id) => {
    const link = links.find((l) => l.device_id === id);
    const own = Object.entries(streams)
      .filter(([key]) => key.startsWith(`${id}|`))
      .map(([key, history]) => [key.split("|")[1], history] as [string, Timed<StreamWindow>[]]);
    const latest = own.map(([, history]) => history[history.length - 1].value);
    const silent = latest.flatMap((w) => (w.silent_s === null ? [] : [w.silent_s]));
    const deviceCommands = commands[id] ?? [];
    return {
      id,
      link,
      streams: own,
      ping: summarizePings(pings[id] ?? []),
      kbps: latest.reduce((sum, w) => sum + w.kbps, 0),
      gaps: latest.reduce((sum, w) => sum + w.total_gaps, 0),
      commandRtt: deviceCommands[deviceCommands.length - 1]?.rtt_ms ?? null,
      clock: bestClock(clocks[id] ?? []),
      lastHeard: silent.length ? Math.min(...silent) : null,
    };
  });
  const online = rows.filter((r) => r.link?.zenoh_connected).length;

  return (
    <>
      <TrafficCard online={online} total={rows.length} />
      {status?.ping_error && <span className={styles.bad}>Ping failed: {status.ping_error}</span>}
      <section className={styles.card}>
        {rows.length === 0 ? (
          <span className={styles.empty}>Waiting for devices…</span>
        ) : (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.deviceTable}`}>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Type</th>
                  <th>RTT (ms)</th>
                  <th>RTT p95 (60 s)</th>
                  <th>Ping loss (%)</th>
                  <th>Data (kbps)</th>
                  <th>Gaps</th>
                  <th>Command RTT (ms)</th>
                  <th>Clock offset (ms)</th>
                  <th>Reconnects</th>
                  <th>Last heard (s)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const connected = r.link?.zenoh_connected;
                  return (
                    <Fragment key={r.id}>
                      <tr className={styles.clickable} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        <td>
                          <span className={styles.deviceName}>
                            <StatusDot status={connected == null ? "unknown" : connected ? "online" : "offline"} size={7} />
                            {r.id}
                          </span>
                        </td>
                        <td className={styles.faint}>{devices[r.id]?.type ?? "–"}</td>
                        <td className={styles[rttLevel(r.ping.last)]}>{fmt(r.ping.last)}</td>
                        <td className={styles[rttLevel(r.ping.p95)]}>{fmt(r.ping.p95)}</td>
                        <td className={styles[lossLevel(r.ping.lossPct)]}>{fmt(r.ping.lossPct)}</td>
                        <td>{fmt(r.kbps)}</td>
                        <td className={r.gaps ? styles.warn : undefined}>{r.gaps}</td>
                        <td>{fmt(r.commandRtt)}</td>
                        <td
                          className={styles[offsetLevel(r.clock?.offset_ms ?? null)]}
                          title={r.clock ? `±${fmt(r.clock.rtt_ms / 2)} ms (half the probe's round trip)` : "No time_probe reply yet"}
                        >
                          {r.clock ? `${r.clock.offset_ms > 0 ? "+" : ""}${fmt(r.clock.offset_ms)}` : "–"}
                        </td>
                        <td className={r.link?.reconnects ? styles.warn : undefined}>{r.link?.reconnects ?? "–"}</td>
                        <td>{fmt(r.lastHeard)}</td>
                      </tr>
                      {open === r.id && (
                        <tr className={styles.detailRow}>
                          <td colSpan={11}>
                            <div className={styles.detail}>
                              <div className={styles.cardHeader}>
                                <span className={styles.muted}>Ping RTT, last 2 min</span>
                                <Sparkline
                                  values={recent(pings[r.id] ?? [], SPARK_SEC).map((p) => p.rtt_ms)}
                                  marks={recent(pings[r.id] ?? [], SPARK_SEC).map((p) => p.lost)}
                                />
                                <span className={styles.grow} />
                                <IpEditor
                                  key={status?.manual_ips[r.id] ?? r.link?.ip ?? ""}
                                  deviceId={r.id}
                                  ip={r.link?.ip ?? null}
                                  manualIp={status?.manual_ips[r.id]}
                                />
                              </div>
                              <StreamTable streams={r.streams} offset={r.clock?.offset_ms ?? null} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>Events</h3>
        {events.length === 0 ? (
          <span className={styles.muted}>No disconnects or gaps since this page opened.</span>
        ) : (
          <ul className={styles.events}>
            {events.slice(0, 30).map((e, i) => (
              <li key={`${e.t}-${i}`}>
                <span className={styles.mono}>{new Date(e.t * 1000).toLocaleTimeString()}</span>
                <b>{e.device_id}</b>
                <span className={e.kind === "gap" ? styles.warn : styles.bad}>{describe(e)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
