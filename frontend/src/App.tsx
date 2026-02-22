import { useState, useEffect, useRef } from "react";
import { MapView } from "./mapview";
import { useWaypoint } from "./waypoint";
import { publishMission } from "./publisher";
import { ToastProvider, useToast } from "./Toast";
import { useRosConnection } from "./useRosConnection";

function AppInner() {
  const waypoints = useWaypoint((s) => s.waypoints);
  const mode = useWaypoint((s) => s.mode);
  const setMode = useWaypoint((s) => s.setMode);
  const [isWaypointListExpanded, setIsWaypointListExpanded] = useState(false);

  const { show } = useToast();
  const { status, url } = useRosConnection();
  const prevStatusRef = useRef(status);

  // Fire toast on connection status change (skip very first render)
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;

    if (status === "connected") {
      const host = (() => { try { return new URL(url).host; } catch { return url; } })();
      show("success", "ROS Connected", host || "rosbridge");
    } else if (status === "disconnected" && prev === "connected") {
      show("error", "ROS Disconnected", "Connection lost");
    }
  }, [status, url, show]);

  const handlePublishMission = () => {
    publishMission(waypoints);
    show("info", "Mission Published", `${waypoints.length} waypoint${waypoints.length !== 1 ? "s" : ""} sent`);
  };

  const modes = [
    { key: "off",    label: "Off",        description: "No interaction with map",                         gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
    { key: "init",   label: "Initialize", description: "Click & drag to set robot initial pose",          gradient: "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)" },
    { key: "modify", label: "Modify",     description: "Click empty space to add, drag waypoint to move", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
    { key: "delete", label: "Delete",     description: "Click waypoint to delete",                        gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" },
  ] as const;

  const modeIndex = modes.findIndex((m) => m.key === mode);
  const itemHeight = 48;
  const gap = 4;

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      {/* Sidebar */}
      <div style={{
        width: "20%", minWidth: 280, maxWidth: 400, padding: 20,
        background: "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
        overflowY: "auto", boxShadow: "4px 0 12px rgba(0,0,0,0.08)",
        display: "flex", flexDirection: "column",
      }}>

        {/* Header + ROS status */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "#212529" }}>Mission Editor</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ position: "relative", width: 10, height: 10 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%", position: "absolute",
                background: status === "connected" ? "#38ef7d" : status === "connecting" ? "#ffd200" : "#e74c3c",
              }} />
              {status === "connected" && (
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", position: "absolute",
                  background: "#38ef7d", animation: "rosping 1.5s ease-out infinite", opacity: 0,
                }} />
              )}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: status === "connected" ? "#2d9e5f" : status === "connecting" ? "#b8860b" : "#c0392b",
            }}>
              {status === "connected" ? "ROS" : status === "connecting" ? "Connecting" : "No ROS"}
            </span>
          </div>
        </div>

        {/* Mode selector */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Mode
          </h4>
          <div style={{ background: "#fff", borderRadius: 12, padding: 4, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)", position: "relative" }}>
            <div style={{
              position: "absolute", top: 4, left: 4, right: 4, height: `${itemHeight}px`,
              background: modes[modeIndex].gradient, borderRadius: 8,
              transform: `translateY(${modeIndex * (itemHeight + gap)}px)`,
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }} />
            <div style={{ display: "flex", flexDirection: "column", gap, position: "relative", zIndex: 1 }}>
              {modes.map((m) => (
                <button key={m.key} onClick={() => setMode(m.key)} style={{
                  height: itemHeight, padding: "0 16px", background: "transparent",
                  color: mode === m.key ? "white" : "#6c757d", border: "none", borderRadius: 8,
                  cursor: "pointer", fontWeight: mode === m.key ? 600 : 500, fontSize: 15,
                  transition: "color 0.3s ease", display: "flex", alignItems: "center", gap: 8, textAlign: "left",
                }}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, padding: 12, background: "#fff", borderRadius: 8, fontSize: 13, color: "#6c757d", lineHeight: 1.5, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            {modes.find((m) => m.key === mode)?.description}
          </div>
        </div>

        {/* Publish button */}
        <button
          onClick={handlePublishMission}
          disabled={waypoints.length === 0}
          style={{
            padding: "14px 20px", color: "white", border: "none", borderRadius: 10,
            cursor: waypoints.length === 0 ? "not-allowed" : "pointer",
            width: "100%", fontSize: 16, fontWeight: 600, marginBottom: 20,
            background: waypoints.length === 0 ? "#adb5bd" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            boxShadow: waypoints.length === 0 ? "none" : "0 4px 12px rgba(102, 126, 234, 0.4)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => { if (waypoints.length > 0) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(102, 126, 234, 0.5)"; } }}
          onMouseLeave={(e) => { if (waypoints.length > 0) { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)"; } }}
        >
          Publish Mission ({waypoints.length})
        </button>

        {/* Waypoint list */}
        <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div
            onClick={() => setIsWaypointListExpanded(!isWaypointListExpanded)}
            style={{ padding: "14px 16px", background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, #e8ebf0 0%, #b8c6db 100%)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)"; }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: "#495057" }}>Waypoints ({waypoints.length})</span>
            <span style={{ fontSize: 18, transition: "transform 0.3s ease", transform: isWaypointListExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▼</span>
          </div>
          <div style={{ maxHeight: isWaypointListExpanded ? "400px" : "0", overflow: "hidden", transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }}>
            <div style={{ padding: isWaypointListExpanded ? "12px 0" : "0", maxHeight: 300, overflowY: "auto" }}>
              {waypoints.length === 0 ? (
                <div style={{ padding: "20px 16px", textAlign: "center", color: "#adb5bd", fontSize: 13 }}>
                  No waypoints yet. Switch to Modify mode to add some!
                </div>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {waypoints.map((wp, i) => (
                    <li key={wp.id}
                      style={{ padding: "10px 16px", borderBottom: i < waypoints.length - 1 ? "1px solid #e9ecef" : "none", fontSize: 13, color: "#495057", display: "flex", alignItems: "center", gap: 8 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#f8f9fa"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "white", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                        {i + 1}
                      </span>
                      <span style={{ fontFamily: "monospace" }}>({wp.x.toFixed(2)}, {wp.y.toFixed(2)})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1 }} />
      </div>

      {/* Map */}
      <div style={{ flex: 1, position: "relative" }}>
        <MapView />
      </div>

      <style>{`
        @keyframes rosping {
          0%   { transform: scale(1);   opacity: 0.7; }
          100% { transform: scale(2.8); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}