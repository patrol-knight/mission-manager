import { useDeviceInspector } from "./useDeviceInspector";
import { useDeviceStore, selectAlertCounts } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useMissionStore } from "../../stores/missionStore";
import { useCameraSession } from "./useCameraSession";
import { useApiConnection } from "../../hooks/useApiConnection";
import { CameraStreamView } from "../cameras/CameraStreamView";
import { DeviceStatusPanel } from "./DeviceStatusPanel";
import { Modal, ModalHeader } from "../../components/ui/Modal";
import { Note } from "../../components/ui/Note";
import { Pill, type PillTone } from "../../components/ui/Pill";
import { deviceConnectivity, type DeviceConnectivity } from "./connectivity";
import { robotStatus } from "./robotStatus";
import layout from "../cameras/CameraWindow.module.css";

const CONNECTIVITY_TONE: Record<DeviceConnectivity["status"], PillTone> = {
  online: "success",
  offline: "danger",
  unknown: "muted",
};

/** A device's window: its live camera, and beside it what an operator
 * checks about the device (DeviceStatusPanel). Type, connection and -- for
 * the robot -- what it's doing sit as pills in the header. General browsing
 * only: anomaly verification lives in features/investigation/VerifyModal. */
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
  const alerts = useDeviceStore((s) => (selectedDeviceId ? (selectAlertCounts(s)[selectedDeviceId] ?? 0) : 0));
  const investigation = useInvestigationStore((s) => s.investigation);
  const execution = useMissionStore((s) => s.execution);

  if (!inspectorOpen || !device) return null;

  const connectivity = deviceConnectivity(device, wsStatus === "connected");
  const name = device.name ?? device.deviceId;
  const activity = device.type === "robot" ? robotStatus(connectivity.status === "online", investigation, execution) : null;

  return (
    <Modal label={`${name} inspector`} onClose={closeInspector} variant="fullscreen">
      <ModalHeader title={name} onClose={closeInspector} closeLabel="Close inspector">
        <span className={layout.headerPills}>
          <Pill tone="neutral">{device.type === "robot" ? "Robot" : "IoT tower"}</Pill>
          <Pill tone={CONNECTIVITY_TONE[connectivity.status]} dot={connectivity.status === "online"} title={connectivity.title}>
            {connectivity.status === "online" ? "Online" : connectivity.status === "offline" ? "Offline" : "Unknown"}
          </Pill>
          {activity && activity.label !== "Offline" && (
            <Pill tone={activity.tone} dot={activity.live}>
              {activity.label}
            </Pill>
          )}
        </span>
      </ModalHeader>
      <div className={layout.body}>
        <div className={layout.stage}>
          <div className={layout.feed}>
            {error ? <Note tone="danger">{error}</Note> : <CameraStreamView camera={camera} stream={stream} />}
          </div>
        </div>
        <aside className={layout.sidebar}>
          <DeviceStatusPanel device={device} camera={camera} alerts={alerts} />
        </aside>
      </div>
    </Modal>
  );
}
