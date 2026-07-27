import { useEffect, useRef, useState } from "react";
import { useAnomalyVerify } from "./useAnomalyVerify";
import { useDeviceStore } from "../../stores/deviceStore";
import { useCameraSession } from "../devices/useCameraSession";
import { useToast } from "../../components/useToast";
import { verifyAnomaly, dismissAnomaly } from "../../api/anomalyApi";
import type { CameraInfo } from "../../types/domain";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const CAMERA_STATUS_LABEL: Record<CameraInfo["status"], string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  offline: "Offline",
  error: "Error",
};

/** Single fixed camera view -- deliberately not CameraGrid/CameraFocusView:
 * this window shows exactly one camera, no grid-of-many or click-to-focus
 * interaction, since verifying an anomaly only ever needs "the" relevant
 * feed, not a browsing experience. */
function SingleCameraView({ camera }: { camera: CameraInfo | null }) {
  if (!camera) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#868e96", fontSize: 14 }}>
        No camera available for this device.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#111317", borderRadius: 8, color: "#fff" }}>
        {camera.status === "live" ? (
          <span style={{ fontSize: 48 }}>🎥</span>
        ) : camera.status === "connecting" ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.2)",
              borderTopColor: "#fff",
              animation: "camera-tile-spin 0.8s linear infinite",
            }}
          />
        ) : (
          <span style={{ fontSize: 32 }}>{camera.status === "error" ? "⚠" : "📴"}</span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#adb5bd" }}>
        <span>{camera.name}</span>
        <span>{CAMERA_STATUS_LABEL[camera.status]}</span>
      </div>
    </div>
  );
}

/** Standalone verify/dismiss window for an anomaly the robot has arrived
 * at -- deliberately separate from DeviceInspectorOverlay (general device/
 * camera browsing) so anomaly resolution has its own minimal, dedicated
 * surface: camera feed plus Verify/Dismiss, nothing else -- no device
 * status panel, and no close button. Verify/Dismiss are the only way out
 * on purpose: MissionStatusPanel's "Review Anomaly" button is the sole
 * reopen path if this were dismissable without deciding, and always
 * reflects live anomaly state -- but requiring a decision here is simpler
 * and avoids the old stuck-state bug at its source rather than just
 * papering over it with a way back in. */
export function AnomalyVerifyModal() {
  const { verifyingAnomalyId, close } = useAnomalyVerify();
  const anomaly = useDeviceStore((s) => (verifyingAnomalyId ? s.anomalies[verifyingAnomalyId] : undefined));
  const upsertAnomaly = useDeviceStore((s) => s.upsertAnomaly);
  // The anomaly's own sourceDeviceId is the IoT sensor that *detected* it,
  // not the robot -- once the robot has arrived to investigate, its camera
  // (the one actually on-site now) is what's useful to verify with, not the
  // stationary sensor's. Single-robot system, same assumption the backend's
  // get_connected_robot() makes.
  const robotDeviceId = useDeviceStore((s) => Object.values(s.devices).find((d) => d.type === "robot")?.deviceId ?? null);
  const { cameras, error } = useCameraSession(robotDeviceId, true);
  const { show } = useToast();
  const [pending, setPending] = useState<"verify" | "dismiss" | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const open = Boolean(verifyingAnomalyId && anomaly);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    // Tab-cycling only -- no Escape handler, since there's no close path
    // that doesn't go through Verify/Dismiss.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  if (!open || !anomaly) return null;

  const resolved = anomaly.status === "verified";
  const busy = pending !== null || resolved;

  const handle = async (action: "verify" | "dismiss") => {
    setPending(action);
    try {
      const updated = action === "verify" ? await verifyAnomaly(anomaly.anomalyId) : await dismissAnomaly(anomaly.anomalyId);
      upsertAnomaly(updated);
      // No success toast here -- DiversionNotifier announces the single
      // "anomaly resolved, robot returning to mission" message once the
      // backend actually starts the return leg, instead of this and that
      // firing back to back for the same event.
      close();
    } catch (err) {
      show("error", action === "verify" ? "Verify failed" : "Dismiss failed", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20000,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Verify anomaly"
        tabIndex={-1}
        style={{
          width: "90vw",
          height: "90vh",
          background: "#1a1b1e",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", borderBottom: "1px solid #343a40" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Verify Anomaly</span>
        </div>
        <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
          {error ? (
            <div style={{ color: "#ff8787", fontSize: 13 }}>{error}</div>
          ) : (
            <SingleCameraView camera={cameras[0] ?? null} />
          )}
        </div>
        <div style={{ padding: 16, borderTop: "1px solid #343a40", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={() => void handle("dismiss")}
            disabled={busy}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "1px solid #495057",
              background: "transparent",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {pending === "dismiss" ? "Marking…" : "Mark False Positive"}
          </button>
          <button
            onClick={() => void handle("verify")}
            disabled={busy}
            style={{
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: resolved ? "#495057" : "#2f9e44",
              color: "#fff",
              fontWeight: 600,
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {resolved ? "Confirmed Real" : pending === "verify" ? "Confirming…" : "Confirm Real"}
          </button>
        </div>
      </div>
      <style>{`@keyframes camera-tile-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
