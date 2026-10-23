import { useDeviceInspector } from "./useDeviceInspector";
import { useDeviceStore } from "../../stores/deviceStore";
import { useCameraSession } from "./useCameraSession";
import { useApiConnection } from "../../hooks/useApiConnection";
import { CameraStreamView } from "../cameras/CameraStreamView";
import { DeviceStatusPanel } from "./DeviceStatusPanel";
import { Modal, ModalHeader } from "../../components/ui/Modal";
import { Note } from "../../components/ui/Note";
import { StatusDot } from "../../components/ui/StatusDot";
import { statusColor } from "../../components/ui/status";
import { deviceConnectivity } from "./connectivity";

/** General device/camera browsing only -- anomaly verification lives in
 * features/investigation/VerifyModal, not here. */
export function DeviceInspectorOverlay() {
  const { inspectorOpen, selectedDeviceId, closeInspector } = useDeviceInspector();
  const device = useDeviceStore((s) => (selectedDeviceId ? s.devices[selectedDeviceId] : undefined));
  const hasKnownCamera = useDeviceStore((s) => (selectedDeviceId ? Boolean(s.cameras[selectedDeviceId]) : false));
  // zenoh_bridge doesn't populate DeviceState.capabilities today, so
  // capabilities alone would never open a camera session for a real device.
  // The cameras store slice (fed by the separate camera-state relay) is the
  // more reliable signal -- fall back to it whenever capabilities hasn't
  // caught up.
  const hasCameraCapability = (device?.capabilities.includes("camera") ?? false) || hasKnownCamera;
  const { camera, stream, error } = useCameraSession(
    inspectorOpen ? (selectedDeviceId ?? null) : null,
    hasCameraCapability,
  );
  const { status: wsStatus } = useApiConnection();

  if (!inspectorOpen || !device) return null;

  const backendConnected = wsStatus === "connected";
  const connectivity = deviceConnectivity(device, backendConnected);
  const name = device.name ?? device.deviceId;

  return (
    <Modal label={`${name} inspector`} onClose={closeInspector} variant="fullscreen">
      <ModalHeader title={name} onClose={closeInspector} closeLabel="Close inspector">
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: "var(--text-sm)",
            color: statusColor(connectivity.status),
          }}
        >
          <StatusDot status={connectivity.status} size={7} />
          {connectivity.title}
        </span>
      </ModalHeader>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 3, padding: 16, minWidth: 0 }}>
          {error ? <Note tone="danger">{error}</Note> : <CameraStreamView camera={camera} stream={stream} />}
        </div>
        <div
          style={{
            flex: 1,
            padding: 16,
            overflowY: "auto",
            borderLeft: "1px solid var(--color-border)",
            minWidth: 220,
          }}
        >
          <DeviceStatusPanel device={device} backendConnected={backendConnected} />
        </div>
      </div>
    </Modal>
  );
}
