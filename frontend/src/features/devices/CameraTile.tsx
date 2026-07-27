import type { CameraInfo } from "../../types/domain";

const STATUS_LABEL: Record<CameraInfo["status"], string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline",
  error: "Error",
};

interface CameraTileProps {
  camera: CameraInfo;
  onFocus: () => void;
}

export function CameraTile({ camera, onFocus }: CameraTileProps) {
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
      {camera.status === "live" ? (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
          {/* Mock-only this pass — a real <video> element replaces this once WebRTC lands. */}
          <span style={{ fontSize: 32 }}>🎥</span>
        </div>
      ) : camera.status === "connecting" ? (
        <Spinner />
      ) : (
        <span style={{ fontSize: 24 }}>{camera.status === "error" ? "⚠" : "📴"}</span>
      )}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "4px 8px",
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
        }}
      >
        <span>{camera.name}</span>
        <span>{STATUS_LABEL[camera.status]}</span>
      </div>
    </button>
  );
}

function Spinner() {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.2)",
        borderTopColor: "#fff",
        animation: "camera-tile-spin 0.8s linear infinite",
      }}
    />
  );
}
