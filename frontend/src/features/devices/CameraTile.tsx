import type { CameraInfo } from "../../types/domain";
import { CameraStreamView } from "../cameras/CameraStreamView";

interface CameraTileProps {
  camera: CameraInfo;
  stream: MediaStream | null;
  onFocus: () => void;
}

export function CameraTile({ camera, stream, onFocus }: CameraTileProps) {
  return (
    <button
      onClick={onFocus}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#111317",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        color: "#fff",
        minHeight: 120,
        overflow: "hidden",
        padding: 0,
      }}
    >
      <CameraStreamView camera={camera} stream={stream} />
    </button>
  );
}
