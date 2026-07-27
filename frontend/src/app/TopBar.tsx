import { useApiConnection } from "../hooks/useApiConnection";
import type { ConnectionStatus } from "../types/ws";

export function TopBar() {
  const { status } = useApiConnection();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        background: "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        flexShrink: 0,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "#212529" }}>
        Mission Manager
      </h1>
      <StatusPill label="Backend" status={status} />
    </div>
  );
}

function StatusPill({ label, status }: { label: string; status: ConnectionStatus }) {
  const color =
    status === "connected" ? "#28a745" : status === "connecting" ? "#ffc107" : "#dc3545";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span style={{ fontSize: 12, fontWeight: 600, color }}>
        {label}: {status}
      </span>
    </div>
  );
}
