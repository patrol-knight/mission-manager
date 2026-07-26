import type { Device } from "../../types/domain";

interface DeviceStatusPanelProps {
  device: Device;
  /** Whether the backend/websocket connection itself is up -- when it
   * isn't, device.connected is stale (no fresh telemetry to refute or
   * confirm it), so this row should read "Unknown," not a possibly-wrong
   * "Connected." */
  backendConnected: boolean;
}

export function DeviceStatusPanel({ device, backendConnected }: DeviceStatusPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
      <Row label="Position X" value={device.pose.x.toFixed(2)} />
      <Row label="Position Y" value={device.pose.y.toFixed(2)} />

      {device.type === "robot" && (
        <>
          <Row label="Speed" value={device.speed !== null ? `${device.speed.toFixed(2)} m/s` : "—"} />
          <Row label="Heading" value={`${(device.pose.yaw * (180 / Math.PI)).toFixed(0)}°`} />
          <Row label="Mission status" value="unavailable (pending backend support)" />
        </>
      )}

      {device.type === "iot" && (
        <Row
          label="Connectivity"
          value={!backendConnected ? "Unknown (backend disconnected)" : device.connected ? "Connected" : "Disconnected"}
        />
      )}

      {device.battery !== null && <Row label="Battery" value={`${device.battery.toFixed(0)}%`} />}

      {Object.keys(device.status).length > 0 && (
        <div>
          <div style={{ color: "#868e96", marginBottom: 4 }}>Sensor values</div>
          {Object.entries(device.status).map(([key, value]) => (
            <Row key={key} label={key} value={String(value)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "#868e96" }}>{label}</span>
      <span style={{ color: "#f8f9fa", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
