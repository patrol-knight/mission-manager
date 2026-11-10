import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { useRealtimeSubscription } from "../../hooks/useRealtimeSubscription";
import { useNow } from "../../hooks/useNow";
import { useToast } from "../../components/useToast";
import { devApi } from "./devApi";
import { connectDevSocket, type BrowserRowsProvider } from "./devSocket";
import { useDevStore } from "./devStore";
import { Segmented } from "./controls";
import { HeatmapView } from "./heatmap/HeatmapView";
import { LocalizeView } from "./LocalizeView";
import { NetworkDevices } from "./NetworkDevices";
import { fmt, percentile, recent } from "./metrics";
import { WebrtcPanel } from "./WebrtcPanel";
import styles from "./DevPage.module.css";

type Tab = "network" | "heatmap" | "localize";
type NetworkSection = "devices" | "video";

const TAB_LABELS: Record<Tab, string> = { network: "Network", heatmap: "Heatmap", localize: "Localize" };

function duration(fromIso: string | null, toMs: number): string {
  if (!fromIso) return "";
  const sec = Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Records every 1 s window, ping, WebRTC stats and robot pose to
 * data/runs/<time>/ until stopped. */
function RecordButton() {
  const status = useDevStore((s) => s.status);
  const now = useNow(1000);
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const recording = status?.recording ?? null;

  const toggle = () => {
    setBusy(true);
    (recording ? devApi.stopRun() : devApi.startRun())
      .then((r) => {
        if (recording && r.run_id) show("success", `Saved data/runs/${r.run_id}`, `Plots: python -m tools.analyzer data/runs/${r.run_id}`);
      })
      .catch((err: unknown) => show("error", err instanceof Error ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  };

  return recording ? (
    <Button size="sm" variant="dangerSolid" disabled={busy} onClick={toggle}>
      <span className={styles.recDot} />
      Stop {duration(status?.started_at ?? null, now)}
    </Button>
  ) : (
    <Button size="sm" disabled={busy} onClick={toggle} title="Record links, pings, WebRTC stats and robot pose to data/runs/">
      Record
    </Button>
  );
}

function NetworkView({ registerProvider }: { registerProvider: (p: BrowserRowsProvider | null) => void }) {
  const [view, setView] = useState<NetworkSection>("devices");
  return (
    <>
      <div className={styles.sectionBar}>
        <Segmented<NetworkSection>
          options={[["devices", "Devices"], ["video", "Video stream"]]}
          value={view}
          onChange={setView}
        />
        <span className={styles.grow} />
        <RecordButton />
      </div>
      {view === "devices" && <NetworkDevices />}
      {/* Kept mounted so a stream and its recorded stats survive switching. */}
      <div hidden={view !== "video"}>
        <WebrtcPanel registerProvider={registerProvider} />
      </div>
    </>
  );
}

export function DevPage() {
  useRealtimeSubscription();
  const [tab, setTab] = useState<Tab>("network");
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
          {(["network", "heatmap", "localize"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
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
        {tab === "network" && <NetworkView registerProvider={registerProvider} />}
        {tab === "localize" && <LocalizeView />}
        {tab === "heatmap" && <HeatmapView />}
      </main>
    </div>
  );
}
