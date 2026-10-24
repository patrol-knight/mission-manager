import { useApiConnection } from "../hooks/useApiConnection";
import { useMissionEditor } from "../features/missions/useMissionEditor";
import { MissionCard } from "../features/missions/MissionCard";
import { MissionLibraryPanel } from "../features/missions/MissionLibraryPanel";
import { MissionEditorPanel } from "../features/missions/MissionEditorPanel";
import { AnomalyCard } from "../features/anomalies/AnomalyCard";
import { InvestigateCard } from "../features/investigation/InvestigateCard";
import { RobotCard } from "../features/devices/RobotCard";
import { TowersCard, TowersPanel } from "../features/devices/TowersCard";
import { Pill, type PillTone } from "../components/ui/Pill";
import { SectionLabel } from "../components/ui/SectionLabel";
import type { ConnectionStatus } from "../types/ws";
import styles from "./RightPanel.module.css";

export type PanelView = "monitor" | "towers" | "library" | "editor";

interface RightPanelProps {
  view: PanelView;
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  /** The full tower list ("+N more"), and back. */
  onOpenTowers: () => void;
  onCloseTowers: () => void;
  /** Switch to the editor (its draft is already set); leaving it goes back
   * to `returnTo`. */
  onEnterEditor: (returnTo: "monitor" | "library") => void;
  onExitEditor: () => void;
}

const BACKEND_PILL: Record<ConnectionStatus, { label: string; tone: PillTone }> = {
  connected: { label: "Live", tone: "success" },
  connecting: { label: "Connecting", tone: "warning" },
  disconnected: { label: "Offline", tone: "danger" },
};

export function RightPanel({
  view,
  onOpenLibrary,
  onCloseLibrary,
  onOpenTowers,
  onCloseTowers,
  onEnterEditor,
  onExitEditor,
}: RightPanelProps) {
  const { status } = useApiConnection();
  const backend = BACKEND_PILL[status];
  const { dispatch } = useMissionEditor();

  const createMission = () => {
    dispatch({ type: "OPEN", mission: null });
    onEnterEditor("monitor");
  };

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h1 className={styles.brand}>Mission Manager</h1>
        <Pill tone={backend.tone} dot={status === "connected"} title={`Backend: ${status}`}>
          {backend.label}
        </Pill>
      </header>

      {view === "monitor" ? (
        <>
          <div className={styles.top}>
            {/* Mission first; while investigating it folds away and the
                investigation takes the lead, then the clicked anomaly. */}
            {/* Edit opens the mission list -- only offered while nothing
                runs, so the mission can't be switched mid-run. */}
            {/* Each block in its mode's color (tokens.css .mode-*); display:
                contents keeps the panel's spacing as if they weren't wrapped. */}
            <div className="mode-mission" style={{ display: "contents" }}>
              <MissionCard onEdit={onOpenLibrary} onCreate={createMission} />
            </div>
            <div className="mode-investigate" style={{ display: "contents" }}>
              <InvestigateCard />
              <AnomalyCard />
            </div>
          </div>
          <div className={styles.bottom} data-fit-container>
            <SectionLabel>Fleet</SectionLabel>
            <RobotCard />
            <TowersCard onShowAll={onOpenTowers} />
          </div>
        </>
      ) : view === "towers" ? (
        <div className={styles.full}>
          <TowersPanel onBack={onCloseTowers} />
        </div>
      ) : (
        // Mission library and editor: the mauve editing mode.
        <div className={`${styles.full} mode-edit`}>
          {view === "library" ? (
            <MissionLibraryPanel onBack={onCloseLibrary} onEnterEditor={() => onEnterEditor("library")} />
          ) : (
            <MissionEditorPanel onCancel={onExitEditor} onSaved={onExitEditor} />
          )}
        </div>
      )}
    </aside>
  );
}
