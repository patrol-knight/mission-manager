import { useEffect, useState } from "react";
import devStyles from "../DevPage.module.css";
import { Interval, Segmented, Toggle, VerdictMix } from "./controls";
import { errorText } from "./historyFormat";
import { historyApi, type DevicesReport, type Estimate, type HistoryStatus, type SourceFilter } from "./historyApi";
import styles from "./History.module.css";

function rate(estimate: Estimate) {
  const f = (v: number) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2));
  return (
    <>
      {f(estimate.mean)}/h
      <span className={styles.small}>
        {f(estimate.low)}–{f(estimate.high)}
      </span>
    </>
  );
}

function seconds(v: number | null) {
  return v == null ? <span className={devStyles.faint}>–</span> : `${Math.round(v)} s`;
}

export function DevicesPanel({ status }: { status: HistoryStatus }) {
  const [source, setSource] = useState<SourceFilter>(status.heatmap.sources.length > 1 ? "all" : status.heatmap.sources[0]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [report, setReport] = useState<DevicesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    historyApi
      .devices(source, includeExcluded)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
      })
      .catch((err: unknown) => !cancelled && setError(errorText(err)));
    return () => {
      cancelled = true;
    };
  }, [source, includeExcluded]);

  return (
    <section className={devStyles.card}>
      <div className={styles.toolbar}>
        <Segmented<SourceFilter>
          options={[["sim", "Sim"], ["real", "Real"], ["all", "Both"]]}
          value={source}
          onChange={setSource}
        />
        <span className={styles.inlineLabel}>
          <Toggle on={includeExcluded} onChange={setIncludeExcluded} label="Include excluded sessions" />
          Include excluded sessions
        </span>
        <span className={styles.grow} />
        {report && <span className={devStyles.muted}>{report.system_hours} h of operation on {status.map_name}</span>}
      </div>

      {error ? (
        <div className={devStyles.empty}>{error}</div>
      ) : !report ? (
        <span className={devStyles.muted}>Loading…</span>
      ) : report.devices.length === 0 ? (
        <div className={devStyles.empty}>No alerts on this map yet.</div>
      ) : (
        <div className={devStyles.tableWrap}>
          <table className={devStyles.table}>
            <thead>
              <tr>
                <th>Device</th>
                <th>Online</th>
                <th>Alerts</th>
                <th>Per online hour</th>
                <th style={{ textAlign: "left" }}>Verdicts</th>
                <th style={{ textAlign: "left" }} title="TP / (TP + FP) among verified alerts, 90% interval">
                  True rate
                </th>
                <th style={{ textAlign: "left" }} title="Expired / all alerts: never verified in time">
                  Missed
                </th>
                <th title="Median, detection to dispatch">Dispatch</th>
                <th title="Median, dispatch to arrival">Travel</th>
              </tr>
            </thead>
            <tbody>
              {report.devices.map((d) => (
                <tr key={d.device_id}>
                  <td className={devStyles.mono}>{d.device_id}</td>
                  <td>{d.online_hours == null ? <span className={devStyles.faint}>–</span> : `${d.online_hours.toFixed(1)} h`}</td>
                  <td>{d.alerts}</td>
                  <td>{d.alert_rate ? rate(d.alert_rate) : <span className={devStyles.faint} title="No recorded uptime">–</span>}</td>
                  <td style={{ textAlign: "left" }}>
                    <VerdictMix counts={d} total={d.alerts} />
                  </td>
                  <td>
                    <Interval estimate={d.true_rate} color="var(--color-verdict-true)" n={d.true_positive + d.false_positive} />
                  </td>
                  <td>
                    <Interval estimate={d.missed_rate} color="var(--color-verdict-unclear)" n={d.alerts} />
                  </td>
                  <td>{seconds(d.dispatch_delay_s)}</td>
                  <td>{seconds(d.travel_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className={devStyles.note}>Rates are shrunk toward the site average; bars show 90% credible intervals.</span>
    </section>
  );
}
