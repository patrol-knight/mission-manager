import { MissionStatusPanel } from "../features/missions/MissionStatusPanel";
import { MissionLibraryPanel } from "../features/missions/MissionLibraryPanel";
import { MissionEditorPanel } from "../features/missions/MissionEditorPanel";
import { DeviceConnectivityPanel } from "../features/devices/DeviceConnectivityPanel";

interface RightPanelProps {
  view: "monitor" | "library" | "editor";
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  onEnterEditor: () => void;
  onExitEditorToLibrary: () => void;
}

export function RightPanel({
  view,
  onOpenLibrary,
  onCloseLibrary,
  onEnterEditor,
  onExitEditorToLibrary,
}: RightPanelProps) {
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
          <MissionStatusPanel onOpenLibrary={onOpenLibrary} />
          <DeviceConnectivityPanel />
        </>
      ) : view === "library" ? (
        <MissionLibraryPanel onBack={onCloseLibrary} onEnterEditor={onEnterEditor} />
      ) : (
        <MissionEditorPanel onCancel={onExitEditorToLibrary} onSaved={onExitEditorToLibrary} />
      )}
    </div>
  );
}
