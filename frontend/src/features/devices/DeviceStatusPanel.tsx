import type { ReactNode } from "react";
import type { CameraInfo, Device } from "../../types/domain";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import layout from "../cameras/CameraWindow.module.css";
import { Speed } from "./Speed";

const CAMERA_TEXT: Record<CameraInfo["status"], string> = {
  idle: "Idle",
  connecting: "Connecting…",
  live: "Live",
  no_signal: "No signal",
  offline: "Offline",
  error: "Error",
};

interface DeviceStatusPanelProps {
  device: Device;
  camera: CameraInfo | null;
  /** Open anomalies this device reported (towers). */
  alerts: number;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={layout.section}>
      <h3 className={layout.sectionTitle}>{title}</h3>
      <InfoList gap={8}>{children}</InfoList>
    </section>
  );
}

/**
 * The device window's sidebar, laid out like the verify window's: Status
 * (battery and speed, or a tower's open alerts, and the camera) and
 * Position. Type, connection and what the robot is doing are pills in the
 * window header.
 */
export function DeviceStatusPanel({ device, camera, alerts }: DeviceStatusPanelProps) {
  const pose = device.pose;
  const headingDeg = pose && ((((pose.yaw * 180) / Math.PI) % 360) + 360) % 360;

  return (
    <>
      <Section title="Status">
        {device.battery !== null && <InfoRow label="Battery" value={`${Math.round(device.battery)}%`} />}
        {device.type === "robot" && (
          <InfoRow label="Speed" value={<Speed value={device.speed} digits={2} />} />
        )}
        {device.type === "iot" && <InfoRow label="Open alerts" value={alerts} />}
        <InfoRow label="Camera" value={camera ? CAMERA_TEXT[camera.status] : "—"} />
      </Section>

      <Section title="Position">
        {pose && headingDeg !== null ? (
          <>
            <InfoRow label="X" value={`${pose.x.toFixed(2)} m`} />
            <InfoRow label="Y" value={`${pose.y.toFixed(2)} m`} />
            <InfoRow label="Heading" value={`${headingDeg.toFixed(0)}°`} />
          </>
        ) : (
          <InfoRow label="Localization" value="Not initialized" />
        )}
      </Section>
    </>
  );
}
