import { useEffect, useRef } from "react";
import type { CameraInfo } from "../../types/domain";

const STATUS_LABEL: Record<CameraInfo["status"], string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  no_signal: "No Signal",
  offline: "Offline",
  error: "Error",
};

interface CameraStreamViewProps {
  camera: CameraInfo | null;
  stream: MediaStream | null;
}

/**
 * Shared rendering surface for a device's one camera feed -- the seam
 * DeviceInspectorOverlay and VerifyModal both render
 * through, so the <video>/placeholder/status-badge markup exists in exactly
 * one place instead of being duplicated. Fills its container; sizing and
 * chrome (button frame, grid slot, dialog panel) are the caller's job.
 *
 * `no_signal` renders the video element same as `live` -- the gateway
 * completes WebRTC negotiation and streams a GStreamer videotestsrc
 * placeholder ("NO SIGNAL") even with no real camera frames,
 * so a live MediaStream is expected in both states (see
 * ../../../../zenoh_bridge/docs/video_streaming_pipeline.md §5).
 */
export function CameraStreamView({ camera, stream }: CameraStreamViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  if (!camera) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          width: "100%",
          color: "var(--color-text-muted)",
          fontSize: "var(--text-base)",
        }}
      >
        No camera available for this device.
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-surface-media)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        color: "#fff",
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      ) : camera.status === "connecting" ? (
        <Spinner />
      ) : (
        <span style={{ fontSize: "var(--text-base)", color: "#8b8f98" }}>
          {camera.status === "error" ? "Camera error" : "No video"}
        </span>
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
          justifyContent: "flex-end",
          fontSize: "var(--text-xs)",
        }}
      >
        <span>{STATUS_LABEL[camera.status]}</span>
      </div>
    </div>
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
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
