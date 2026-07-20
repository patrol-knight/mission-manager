import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useDeviceInspector } from "./useDeviceInspector";
import { connectivityStatus } from "../../types/domain";

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

export function DeviceConnectivityPanel() {
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const { openInspector } = useDeviceInspector();

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Devices
      </h3>

      {devices.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>No devices connected</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {devices.map((device) => {
            const connected = connectivityStatus(device) === "connected";
            return (
              <li key={device.deviceId}>
                <button
                  onClick={() => openInspector(device.deviceId)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 6px",
                    borderRadius: 6,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  <span
                    role="status"
                    aria-label={connected ? "connected" : "disconnected"}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: connected ? "#28a745" : "#dc3545",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "#212529" }}>{device.name ?? device.deviceId}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
