import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Pill } from "../../../components/ui/Pill";
import devStyles from "../DevPage.module.css";
import { Segmented } from "./controls";
import { errorText } from "./historyFormat";
import { DevicesPanel } from "./DevicesPanel";
import { historyApi, type HistoryStatus } from "./historyApi";
import { PreviewPanel } from "./PreviewPanel";
import { SessionsPanel } from "./SessionsPanel";
import styles from "./History.module.css";

type View = "sessions" | "devices" | "preview";

function blocker(status: HistoryStatus, view: View): string | null {
  const db = status.database;
  if (!db.configured) return "No database: DATABASE_URL is empty, so no history is recorded.";
  if (!db.connected) return `Can't reach Postgres: ${db.error ?? "unknown error"}`;
  if (!db.schema_ready) return "No history tables yet: they are created when the backend first connects.";
  if (view === "sessions") return null;
  if (!status.map_name) return "No map loaded.";
  if (!status.estimator_installed) {
    return "heatmap-estimator isn't installed: run `git submodule update --init` and rebuild the backend.";
  }
  return null;
}

export function HistoryView() {
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("sessions");

  const load = () => {
    historyApi
      .status()
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)));
  };
  useEffect(load, []);

  if (error) {
    return (
      <section className={`${devStyles.card} ${devStyles.empty}`}>
        <span className={devStyles.bad}>{error}</span>
        <div>
          <Button onClick={load}>Try again</Button>
        </div>
      </section>
    );
  }
  if (!status) return <span className={devStyles.muted}>Loading…</span>;

  const blocked = blocker(status, view);
  return (
    <>
      <div className={styles.bar}>
        <Segmented<View>
          options={[["sessions", "Sessions"], ["devices", "Devices"], ["preview", "Heatmap preview"]]}
          value={view}
          onChange={setView}
        />
        <span className={styles.grow} />
        {status.map_name && <span className={devStyles.muted}>Map {status.map_name}</span>}
        <span title={status.write_enabled ? undefined : "Set DEVTOOLS_HISTORY_WRITE=true on the backend"}>
          <Pill tone={status.write_enabled ? "warning" : "muted"}>
            {status.write_enabled ? "Editing enabled" : "Delete & seed off"}
          </Pill>
        </span>
      </div>
      {blocked ? (
        <section className={`${devStyles.card} ${devStyles.empty}`}>
          <span>{blocked}</span>
          <div>
            <Button onClick={load}>Check again</Button>
          </div>
        </section>
      ) : view === "sessions" ? (
        <SessionsPanel status={status} />
      ) : view === "devices" ? (
        <DevicesPanel status={status} />
      ) : (
        <PreviewPanel status={status} />
      )}
    </>
  );
}
