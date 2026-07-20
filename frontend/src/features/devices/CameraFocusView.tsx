import type { CameraInfo } from "../../types/domain";
import { CameraTile } from "./CameraTile";

interface CameraFocusViewProps {
  camera: CameraInfo;
  onBack: () => void;
}

export function CameraFocusView({ camera, onBack }: CameraFocusViewProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <button
        onClick={onBack}
        style={{
          alignSelf: "flex-start",
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #495057",
          background: "#212529",
          color: "#fff",
          cursor: "pointer",
          fontSize: 13,
        }}
      >
        ← Back to all cameras
      </button>
      <div style={{ flex: 1 }}>
        <CameraTile camera={camera} onFocus={onBack} />
      </div>
    </div>
  );
}
