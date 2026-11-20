import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { CameraInfo } from "../../types/domain";
import { cx } from "../../components/ui/cx";
import { tileCount } from "./cameraTiles";
import styles from "./CameraStreamView.module.css";

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

interface FrameSize {
  stream: MediaStream;
  width: number;
  height: number;
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
 *
 * A camera tower's frame (three images side by side, see cameraTiles.ts) is
 * split back apart: one image large, all three as thumbnails to pick from.
 */
export function CameraStreamView({ camera, stream }: CameraStreamViewProps) {
  const [size, setSize] = useState<FrameSize | null>(null);
  const [selected, setSelected] = useState(1);
  const onSize = useCallback(
    (width: number, height: number) => {
      if (stream) setSize({ stream, width, height });
    },
    [stream],
  );

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

  const statusBar = (
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
      <span>{camera.status === "error" && camera.detail ? camera.detail : STATUS_LABEL[camera.status]}</span>
    </div>
  );

  const measured = stream && size?.stream === stream ? size : null;
  const tiles = measured ? tileCount(measured.width, measured.height) : 1;

  if (stream && measured && tiles > 1) {
    const shown = Math.min(selected, tiles - 1);
    const aspect = measured.width / tiles / measured.height;
    return (
      <div className={styles.tiled} style={{ "--tile-aspect": aspect } as CSSProperties}>
        <div className={styles.main}>
          <div className={styles.frame}>
            <TileVideo stream={stream} tiles={tiles} index={shown} onSize={onSize} />
          </div>
          {statusBar}
        </div>
        <div className={styles.strip} role="group" aria-label="Cameras">
          {Array.from({ length: tiles }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-pressed={i === shown}
              className={cx(styles.thumb, i === shown && styles.thumbOn)}
              onClick={() => setSelected(i)}
            >
              <TileVideo stream={stream} tiles={tiles} index={i} />
              <span className={styles.thumbLabel}>Cam {i + 1}</span>
            </button>
          ))}
        </div>
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
        <StreamVideo
          stream={stream}
          onSize={onSize}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
        />
      ) : camera.status === "connecting" ? (
        <Spinner />
      ) : (
        <span style={{ fontSize: "var(--text-base)", color: "#8b8f98" }}>
          {camera.status === "error" ? "Camera error" : "No video"}
        </span>
      )}
      {statusBar}
    </div>
  );
}

/** One tile of a side-by-side frame, filling a parent of that tile's aspect. */
function TileVideo({
  stream,
  tiles,
  index,
  onSize,
}: {
  stream: MediaStream;
  tiles: number;
  index: number;
  onSize?: (width: number, height: number) => void;
}) {
  return (
    <StreamVideo
      stream={stream}
      onSize={onSize}
      className={styles.tileVideo}
      style={{ width: `${tiles * 100}%`, left: `${-index * 100}%` }}
    />
  );
}

function StreamVideo({
  stream,
  onSize,
  className,
  style,
}: {
  stream: MediaStream;
  onSize?: (width: number, height: number) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.srcObject !== stream) video.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onSize) return;
    const report = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) onSize(video.videoWidth, video.videoHeight);
    };
    report();
    video.addEventListener("loadedmetadata", report);
    video.addEventListener("resize", report);
    return () => {
      video.removeEventListener("loadedmetadata", report);
      video.removeEventListener("resize", report);
    };
  }, [onSize]);

  return <video ref={videoRef} autoPlay playsInline muted className={className} style={style} />;
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
