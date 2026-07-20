import { useEffect, useRef } from "react";
import { useDeviceInspector } from "./useDeviceInspector";
import { useDeviceStore } from "../../stores/deviceStore";
import { useCameraSession } from "./useCameraSession";
import { CameraGrid } from "./CameraGrid";
import { CameraFocusView } from "./CameraFocusView";
import { DeviceStatusPanel } from "./DeviceStatusPanel";
import { AnomalyVerifyButton } from "../anomalies/AnomalyVerifyButton";
import { connectivityStatus } from "../../types/domain";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function DeviceInspectorOverlay() {
  const { inspectorOpen, selectedDeviceId, selectedCameraId, anomalyContext, closeInspector, focusCamera } =
    useDeviceInspector();
  const device = useDeviceStore((s) => (selectedDeviceId ? s.devices[selectedDeviceId] : undefined));
  const hasCameraCapability = device?.capabilities.includes("camera") ?? false;
  const { cameras, error } = useCameraSession(inspectorOpen ? (selectedDeviceId ?? null) : null, hasCameraCapability);

  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!inspectorOpen) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    dialogRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeInspector();
        return;
      }
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
  }, [inspectorOpen, closeInspector]);

  if (!inspectorOpen || !device) return null;

  const focusedCamera = cameras.find((c) => c.id === selectedCameraId) ?? null;
  const connected = connectivityStatus(device) === "connected";

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
        aria-label={`${device.name ?? device.deviceId} inspector`}
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid #343a40" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{device.name ?? device.deviceId}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: connected ? "#51cf66" : "#ff6b6b" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#51cf66" : "#ff6b6b" }} />
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          <button
            onClick={closeInspector}
            aria-label="Close inspector"
            style={{ background: "none", border: "none", color: "#adb5bd", fontSize: 20, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flex: 3, padding: 16, minWidth: 0 }}>
            {error ? (
              <div style={{ color: "#ff8787", fontSize: 13 }}>{error}</div>
            ) : focusedCamera ? (
              <CameraFocusView camera={focusedCamera} onBack={() => focusCamera(null)} />
            ) : (
              <CameraGrid cameras={cameras} onFocusCamera={focusCamera} />
            )}
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", borderLeft: "1px solid #343a40", minWidth: 220 }}>
            <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
              <DeviceStatusPanel device={device} />
            </div>
            {anomalyContext && (
              <div style={{ padding: 16, borderTop: "1px solid #343a40", display: "flex", justifyContent: "flex-end" }}>
                <AnomalyVerifyButton />
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@keyframes camera-tile-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
