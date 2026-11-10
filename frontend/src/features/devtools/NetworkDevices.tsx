import { useMemo, useState } from "react";
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

function OverviewCard({ online, total }: { online: number; total: number }) {
  const traffic = useDevStore((s) => s.traffic);
  const events = useDevStore((s) => s.events);
  const spark = recent(traffic, SPARK_SEC);
  const last = traffic[traffic.length - 1]?.value;
  return (
    <section className={`${styles.card} ${styles.overview}`}>
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
      <div className={styles.eventsPane}>
        <div className={styles.eventsInner}>
          <h4 className={styles.sectionTitle}>Events</h4>
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
        </div>
      </div>
    </section>
  );
}

function DeviceCard({ id }: { id: string }) {
  const link = useDevStore((s) => s.links.find((l) => l.device_id === id));
  const allStreams = useDevStore((s) => s.streams);
  const pings = useDevStore((s) => s.pings[id]);
  const commands = useDevStore((s) => s.commands[id]);
  const clocks = useDevStore((s) => s.clocks[id]);
  const manualIp = useDevStore((s) => s.status?.manual_ips[id]);
  const type = useDeviceStore((s) => s.devices[id]?.type);

  const streams = Object.entries(allStreams)
    .filter(([key]) => key.startsWith(`${id}|`))
    .map(([key, history]) => [key.split("|")[1], history] as [string, Timed<StreamWindow>[]]);
  const latest = streams.map(([, history]) => history[history.length - 1].value);
  const silent = latest.flatMap((w) => (w.silent_s === null ? [] : [w.silent_s]));
  const ping = summarizePings(pings ?? []);
  const sparkPings = recent(pings ?? [], SPARK_SEC);
  const clock = bestClock(clocks ?? []);
  const commandRtt = commands?.[commands.length - 1]?.rtt_ms ?? null;
  const gaps = latest.reduce((sum, w) => sum + w.total_gaps, 0);
  const connected = link?.zenoh_connected;

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <StatusDot status={connected == null ? "unknown" : connected ? "online" : "offline"} />
        <h3 className={styles.cardTitle}>{id}</h3>
        {type && <Pill tone="subtle">{type}</Pill>}
        <span className={styles.grow} />
        <IpEditor key={manualIp ?? link?.ip ?? ""} deviceId={id} ip={link?.ip ?? null} manualIp={manualIp} />
      </div>
      <div className={styles.kpis}>
        <Kpi label="Ping RTT (last)" value={fmt(ping.last)} unit="ms" level={rttLevel(ping.last)}>
          <Sparkline values={sparkPings.map((p) => p.rtt_ms)} marks={sparkPings.map((p) => p.lost)} />
        </Kpi>
        <Kpi label="RTT p50 / p95 (60 s)" value={`${fmt(ping.p50)} / ${fmt(ping.p95)}`} unit="ms" level={rttLevel(ping.p95)} />
        <Kpi label={`Ping loss (${ping.sent} sent)`} value={fmt(ping.lossPct)} unit="%" level={lossLevel(ping.lossPct)} />
        <Kpi label="Zenoh session" value={link ? (connected ? "Connected" : "Lost") : "–"} level={link ? (connected ? "ok" : "bad") : "idle"}>
          <span className={link?.reconnects ? styles.warn : styles.muted}>
            {link ? `${link.reconnects} reconnects` : "not seen on the router"}
          </span>
        </Kpi>
        <Kpi label="Data" value={fmt(latest.reduce((sum, w) => sum + w.kbps, 0))} unit="kbps">
          <span className={gaps ? styles.warn : styles.muted}>{gaps} gaps</span>
        </Kpi>
        <Kpi label="Command RTT" value={fmt(commandRtt)} unit="ms" />
        <Kpi label="Clock offset" value={clock ? `${clock.offset_ms > 0 ? "+" : ""}${fmt(clock.offset_ms)}` : "–"} unit="ms" level={offsetLevel(clock?.offset_ms ?? null)}>
          <span className={styles.muted}>{clock ? `±${fmt(clock.rtt_ms / 2)} ms` : "no time_probe reply yet"}</span>
        </Kpi>
        <Kpi label="Last heard" value={fmt(silent.length ? Math.min(...silent) : null)} unit="s" />
      </div>
      <StreamTable streams={streams} offset={clock?.offset_ms ?? null} />
    </section>
  );
}

export function NetworkDevices() {
  const links = useDevStore((s) => s.links);
  const streams = useDevStore((s) => s.streams);
  const pings = useDevStore((s) => s.pings);
  const pingError = useDevStore((s) => s.status?.ping_error);
  const devices = useDeviceStore((s) => s.devices);

  const deviceIds = useMemo(() => {
    const ids = new Set([...links.map((l) => l.device_id), ...Object.keys(pings), ...Object.keys(devices)]);
    Object.keys(streams).forEach((key) => ids.add(key.split("|")[0]));
    return [...ids].sort();
  }, [links, pings, devices, streams]);
  const online = links.filter((l) => l.zenoh_connected && deviceIds.includes(l.device_id)).length;

  return (
    <>
      <OverviewCard online={online} total={deviceIds.length} />
      {pingError && <span className={styles.bad}>Ping failed: {pingError}</span>}
      {deviceIds.length === 0 && <div className={`${styles.card} ${styles.empty}`}>Waiting for devices…</div>}
      {deviceIds.map((id) => (
        <DeviceCard key={id} id={id} />
      ))}
    </>
  );
}
