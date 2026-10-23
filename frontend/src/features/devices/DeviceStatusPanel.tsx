import type { Device } from "../../types/domain";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { deviceConnectivity } from "./connectivity";

interface DeviceStatusPanelProps {
  device: Device;
  /** Whether the backend/websocket connection itself is up -- when it
   * isn't, device.connected is stale, so connectivity reads "unknown". */
  backendConnected: boolean;
}

export function DeviceStatusPanel({ device, backendConnected }: DeviceStatusPanelProps) {
  const statusEntries = Object.entries(device.status);

  return (
    <InfoList gap={8}>
      <InfoRow label="Position X" value={device.pose.x.toFixed(2)} />
      <InfoRow label="Position Y" value={device.pose.y.toFixed(2)} />

      {device.type === "robot" && (
        <>
          <InfoRow label="Speed" value={device.speed !== null ? `${device.speed.toFixed(2)} m/s` : "—"} />
          <InfoRow label="Heading" value={`${(device.pose.yaw * (180 / Math.PI)).toFixed(0)}°`} />
        </>
      )}

      {device.type === "iot" && (
        <InfoRow label="Connectivity" value={deviceConnectivity(device, backendConnected).title} />
      )}

      {device.battery !== null && <InfoRow label="Battery" value={`${device.battery.toFixed(0)}%`} />}

      {statusEntries.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-md)", marginBottom: 4 }}>
            Sensor values
          </div>
          <InfoList>
            {statusEntries.map(([key, value]) => (
              <InfoRow key={key} label={key} value={String(value)} />
            ))}
          </InfoList>
        </div>
      )}
    </InfoList>
  );
}
