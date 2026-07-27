import type { CameraInfo } from "../../types/domain";
import { CameraTile } from "./CameraTile";

interface CameraGridProps {
  cameras: CameraInfo[];
  onFocusCamera: (id: string) => void;
}

export function CameraGrid({ cameras, onFocusCamera }: CameraGridProps) {
  if (cameras.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#868e96", fontSize: 14 }}>
        No cameras available for this device.
      </div>
    );
  }

  const columns = cameras.length === 1 ? 1 : cameras.length <= 4 ? 2 : 3;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: 8,
        height: "100%",
        overflowY: "auto",
        alignContent: "start",
      }}
    >
      {cameras.map((camera) => (
        <CameraTile key={camera.id} camera={camera} onFocus={() => onFocusCamera(camera.id)} />
      ))}
    </div>
  );
}
