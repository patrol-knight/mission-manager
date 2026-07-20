import { MissionStatusPanel } from "../features/missions/MissionStatusPanel";
import { MissionEditorPanel } from "../features/missions/MissionEditorPanel";
import { DeviceConnectivityPanel } from "../features/devices/DeviceConnectivityPanel";

interface RightPanelProps {
  view: "monitor" | "editor";
  onEnterEditor: () => void;
  onExitEditor: () => void;
}

export function RightPanel({ view, onEnterEditor, onExitEditor }: RightPanelProps) {
  return (
    <div
      style={{
        width: "26%",
        minWidth: 300,
        maxWidth: 380,
        padding: 16,
        overflowY: "auto",
        background: "#f1f3f5",
        boxShadow: "-4px 0 12px rgba(0,0,0,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        flexShrink: 0,
      }}
    >
      {view === "monitor" ? (
        <>
          <MissionStatusPanel onEnterEditor={onEnterEditor} />
          <DeviceConnectivityPanel />
        </>
      ) : (
        <MissionEditorPanel onCancel={onExitEditor} onSaved={onExitEditor} />
      )}
    </div>
  );
}
