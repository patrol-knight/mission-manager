import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Button } from "../../../components/ui/Button";
import buttonStyles from "../../../components/ui/Button.module.css";
import { cx } from "../../../components/ui/cx";
import { Pill } from "../../../components/ui/Pill";
import { useToast } from "../../../components/useToast";
import devStyles from "../DevPage.module.css";
import { Segmented, Toggle, VerdictMix } from "./controls";
import { errorText, formatAgo, formatDuration } from "./historyFormat";
import { historyApi, type HistoryStatus, type SessionPatch, type SessionRow, type Source } from "./historyApi";
import { PurgeDialog, ScenarioDialog, SeedDialog } from "./HistoryDialogs";
import styles from "./History.module.css";

type Dialog =
  | { kind: "seed" | "purge" | "scenario" }
  | { kind: "delete" | "relabel"; session: SessionRow };

const WRITE_HINT = "Set DEVTOOLS_HISTORY_WRITE=true on the backend";

function Kpi({ label, value, foot }: { label: string; value: string | number; foot: string }) {
  return (
    <div className={devStyles.kpi}>
      <span className={devStyles.kpiLabel}>{label}</span>
      <span className={devStyles.kpiValue}>{value}</span>
      <span className={devStyles.note}>{foot}</span>
    </div>
  );
}

function LabelInput({ session, onSave }: { session: SessionRow; onSave: (label: string) => void }) {
  const [value, setValue] = useState(session.label ?? "");
  return (
    <input
      className={styles.labelInput}
      value={value}
      placeholder="Untitled run"
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      onBlur={() => value.trim() !== (session.label ?? "") && onSave(value.trim())}
    />
  );
}

export function SessionsPanel({ status }: { status: HistoryStatus }) {
  const { show } = useToast();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mapFilter, setMapFilter] = useState(status.map_name ?? "");
  const [sourceFilter, setSourceFilter] = useState<"" | Source>("");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const write = status.write_enabled;

  const reload = useCallback(() => {
    historyApi
      .sessions()
      .then((rows) => {
        setSessions(rows);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  useEffect(reload, [reload]);

  const rows = useMemo(
    () =>
      (sessions ?? []).filter(
        (s) => (!mapFilter || s.map_name === mapFilter) && (!sourceFilter || s.source === sourceFilter),
      ),
    [sessions, mapFilter, sourceFilter],
  );
  const maps = useMemo(() => [...new Set((sessions ?? []).map((s) => s.map_name))].sort(), [sessions]);

  const patch = (session: SessionRow, changes: SessionPatch, message: string) => {
    historyApi
      .updateSession(session.id, changes)
      .then(() => {
        setSessions((all) => all?.map((s) => (s.id === session.id ? { ...s, ...changes } : s)) ?? null);
        show("success", message);
      })
      .catch((err: unknown) => show("error", errorText(err)));
  };

  const finished = (message: string) => {
    setDialog(null);
    show("success", message);
    reload();
  };

  if (error) {
    return (
      <section className={`${devStyles.card} ${devStyles.empty}`}>
        <strong>Can't read the database</strong>
        <span>{error}</span>
        <div>
          <Button onClick={reload}>Try again</Button>
        </div>
      </section>
    );
  }
  if (!sessions) return <span className={devStyles.muted}>Loading…</span>;

  const total = rows.reduce((n, s) => n + s.total, 0);
  const real = rows.filter((s) => s.source === "real").reduce((n, s) => n + s.total, 0);
  const verified = rows.reduce((n, s) => n + s.true_positive + s.false_positive, 0);
  const latest = rows.map((s) => s.last_at ?? s.started_at).sort().at(-1);

  return (
    <>
      <div className={devStyles.kpis}>
        <Kpi label="Sessions" value={rows.length} foot={`${rows.filter((s) => !s.excluded).length} in the heatmap`} />
        <Kpi label="Anomalies" value={total.toLocaleString()} foot={`${real} real · ${total - real} sim`} />
        <Kpi label="Verified" value={total ? `${Math.round((verified / total) * 100)}%` : "–"} foot="true or false verdict" />
        <Kpi label="Latest" value={latest ? formatAgo(latest) : "–"} foot="last anomaly closed" />
      </div>

      <section className={devStyles.card}>
        <div className={styles.toolbar}>
          <select className={styles.select} value={mapFilter} onChange={(e) => setMapFilter(e.target.value)}>
            <option value="">All maps</option>
            {maps.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <Segmented<"" | Source>
            options={[["", "All"], ["sim", "Sim"], ["real", "Real"]]}
            value={sourceFilter}
            onChange={setSourceFilter}
          />
          <span className={devStyles.muted}>
            {rows.length} of {sessions.length}
          </span>
          <span className={styles.grow} />
          <a
            className={cx(buttonStyles.button, buttonStyles.md, buttonStyles.secondary)}
            href={historyApi.exportUrl({ map_name: mapFilter || undefined, source: sourceFilter || undefined })}
            download
            style={{ textDecoration: "none" }}
          >
            Export CSV
          </a>
          <span title={write ? undefined : WRITE_HINT} className={styles.actions}>
            <Button disabled={!write} onClick={() => setDialog({ kind: "purge" })}>
              Purge…
            </Button>
            <Button disabled={!write} onClick={() => setDialog({ kind: "scenario" })}>
              Load scenario…
            </Button>
            <Button variant="primary" disabled={!write} onClick={() => setDialog({ kind: "seed" })}>
              Seed dummy data
            </Button>
          </span>
        </div>

        {rows.length === 0 ? (
          <div className={devStyles.empty}>
            {sessions.length ? "No sessions match the filters." : "No history yet: run with an anomaly source, or seed dummy data."}
          </div>
        ) : (
          <div className={devStyles.tableWrap}>
            <table className={devStyles.table}>
              <thead>
                <tr>
                  <th>Session</th>
                  <th style={{ textAlign: "left" }}>Map</th>
                  <th style={{ textAlign: "left" }}>Source</th>
                  <th style={{ textAlign: "left" }}>Recorded</th>
                  <th>Anomalies</th>
                  <th style={{ textAlign: "left" }}>Verdicts</th>
                  <th style={{ textAlign: "left" }}>State</th>
                  <th style={{ textAlign: "left" }}>Heatmap</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const current = s.id === status.current_session_id;
                  return (
                    <tr key={s.id} className={s.excluded ? styles.excluded : undefined}>
                      <td>
                        <div className={styles.name}>
                          <LabelInput key={s.label ?? ""} session={s} onSave={(label) => patch(s, { label }, "Renamed")} />
                          <span className={devStyles.faint}>
                            <span className={devStyles.mono}>{s.id.slice(0, 8)}</span>
                            {current && " · this run"}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: "left" }} title={s.map_hash ? `osm ${s.map_hash}` : undefined}>
                        {s.map_name}
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <button
                          type="button"
                          className={styles.sourceButton}
                          title={`Mark as ${s.source === "sim" ? "real" : "sim"}`}
                          onClick={() => setDialog({ kind: "relabel", session: s })}
                        >
                          <Pill tone={s.source === "real" ? "accent" : "subtle"}>{s.source}</Pill>
                        </button>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        {new Date(s.started_at).toLocaleString()}
                        <div className={devStyles.note}>{formatDuration(s.started_at, s.ended_at ?? s.last_seen_at)}</div>
                      </td>
                      <td>{s.total.toLocaleString()}</td>
                      <td style={{ textAlign: "left" }}>
                        <VerdictMix counts={s} total={s.total} />
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <Pill tone={s.ended_at ? "muted" : "success"} dot={!s.ended_at}>
                          {s.ended_at ? "Ended" : "Open"}
                        </Pill>
                      </td>
                      <td style={{ textAlign: "left" }}>
                        <Toggle
                          on={!s.excluded}
                          label="Include in heatmap"
                          onChange={(on) => patch(s, { excluded: !on }, on ? "Included" : "Excluded")}
                        />
                      </td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={!write}
                          title={write ? undefined : WRITE_HINT}
                          onClick={() => setDialog({ kind: "delete", session: s })}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dialog?.kind === "seed" && <SeedDialog onDone={finished} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "purge" && <PurgeDialog onDone={finished} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "scenario" && <ScenarioDialog onDone={finished} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="Delete session?"
          message={`${dialog.session.label || dialog.session.id.slice(0, 8)} and its ${dialog.session.total} anomalies are removed for good.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const { session } = dialog;
            setDialog(null);
            historyApi
              .deleteSession(session.id)
              .then(() => finished("Session deleted"))
              .catch((err: unknown) => show("error", errorText(err)));
          }}
        />
      )}
      {dialog?.kind === "relabel" && (
        <ConfirmDialog
          title={`Mark as ${dialog.session.source === "sim" ? "real" : "sim"}?`}
          message={`${dialog.session.total} anomalies move to the ${dialog.session.source === "sim" ? "real" : "sim"} heatmap.`}
          confirmLabel="Change"
          cancelLabel="Cancel"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const { session } = dialog;
            const to = session.source === "sim" ? "real" : "sim";
            setDialog(null);
            patch(session, { source: to }, `Marked as ${to}`);
          }}
        />
      )}
    </>
  );
}
