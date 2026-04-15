import * as React from "react";
import { useWaypointStore } from "../stores/waypointStore";
import { useApiConnection } from "../hooks/useApiConnection";
import type { Mode, RobotPose } from "../types";
import type { RouteProgress } from "../stores/waypointStore";
import type { RoutePhase } from "../App";
import { InfoPanel } from "./InfoPanel";

const MODES: { key: Mode; label: string; description: string; gradient: string }[] = [
  { key: "off",    label: "Off",    description: "No interaction",                gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { key: "modify", label: "Modify", description: "Click to add, or drag to move", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { key: "delete", label: "Delete", description: "Click waypoint to delete",      gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" },
];

const ITEM_HEIGHT = 48;
const GAP = 4;

interface SidebarProps {
  routePhase:     RoutePhase;
  isLoading:      boolean;
  onCheckRoute:   () => void;
  onConfirmRoute: () => void;
  onClear:        () => void;
  robotPose:      RobotPose | null;
  routeProgress:  RouteProgress | null;
  waypointCount:  number;
}

export function Sidebar({
  routePhase, isLoading,
  onCheckRoute, onConfirmRoute, onClear,
  robotPose, routeProgress, waypointCount,
}: SidebarProps) {
  const mode    = useWaypointStore((s) => s.mode);
  const setMode = useWaypointStore((s) => s.setMode);
  const { status } = useApiConnection();
  const modeIndex  = MODES.findIndex((m) => m.key === mode);

  const primaryBtn = (() => {
    switch (routePhase) {
      case "idle":
        return {
          label: "Check Route (0)",
          disabled: true,
          onClick: onCheckRoute,
          background: "#adb5bd",
          shadow: "none",
        };
      case "check":
        return {
          label: `Check Route (${waypointCount})`,
          disabled: isLoading,
          onClick: onCheckRoute,
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          shadow: "0 4px 12px rgba(102,126,234,0.4)",
        };
      case "checked":
        return {
          label: "Confirm Route",
          disabled: isLoading,
          onClick: onConfirmRoute,
          background: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
          shadow: "0 4px 12px rgba(17,153,142,0.4)",
        };
    }
  })();

  return (
    <div style={{
      width: "19%", minWidth: 280, maxWidth: 300,
      padding: 20,
      background: "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
      overflowY: "auto",
      boxShadow: "4px 0 12px rgba(0,0,0,0.08)",
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "#212529" }}>PatrolKnight</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusPill label="Backend" status={status} />
          <StatusPill label="Robot"   status={robotPose !== null ? "connected" : "disconnected"} />
        </div>
      </div>

      <div>
        <SectionLabel>Waypoint Operation</SectionLabel>
        <div style={{ background: "#fff", borderRadius: 12, padding: 4, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)", position: "relative" }}>
          <div style={{
            position: "absolute", top: 4, left: 4, right: 4, height: ITEM_HEIGHT,
            background: MODES[modeIndex].gradient, borderRadius: 8,
            transform: `translateY(${modeIndex * (ITEM_HEIGHT + GAP)}px)`,
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }} />
          <div style={{ display: "flex", flexDirection: "column", gap: GAP, position: "relative", zIndex: 1 }}>
            {MODES.map((m) => (
              <button key={m.key} onClick={() => setMode(m.key)} style={{
                height: ITEM_HEIGHT, padding: "0 16px",
                background: "transparent",
                color: mode === m.key ? "white" : "#6c757d",
                border: "none", borderRadius: 8, cursor: "pointer",
                fontWeight: mode === m.key ? 600 : 500, fontSize: 15,
                transition: "color 0.3s ease",
                display: "flex", alignItems: "center", textAlign: "left",
              }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 8, padding: 12, background: "#fff", borderRadius: 8, fontSize: 13, color: "#6c757d", lineHeight: 1.5, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          {MODES.find((m) => m.key === mode)?.description}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={primaryBtn.onClick}
          disabled={primaryBtn.disabled}
          style={{
            flex: 1, padding: "12px 16px", color: "white", border: "none",
            borderRadius: 10,
            cursor: primaryBtn.disabled ? "not-allowed" : "pointer",
            fontSize: 14, fontWeight: 600,
            background: primaryBtn.disabled ? "#adb5bd" : primaryBtn.background,
            boxShadow: primaryBtn.disabled ? "none" : primaryBtn.shadow,
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => {
            if (!primaryBtn.disabled) {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.filter = "brightness(1.05)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "";
            e.currentTarget.style.filter = "";
          }}
        >
          {isLoading ? "Loading…" : primaryBtn.label}
        </button>

        <button
          onClick={onClear}
          style={{
            padding: "12px 14px", background: "#fff",
            color: "#dc3545", border: "1px solid #f5c6cb",
            borderRadius: 10, cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            transition: "all 0.2s", whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#fff5f5"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >
          Clear
        </button>
      </div>

      {/* <RouteProgressCard stats={stats} routeProgress={routeProgress} /> */}
      <InfoPanel robotPose={robotPose} routeProgress={routeProgress} />

      <div style={{ flex: 1 }} />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 style={{ margin: "0 0 10px 0", fontSize: 14, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: "0.5px" }}>
      {children}
    </h4>
  );
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const color     = status === "connected" ? "#28a745" : status === "connecting" ? "#ffc107" : "#dc3545";
  // const textColor = status === "connected" ? "#155724" : status === "connecting" ? "#856404" : "#721c24";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ position: "relative", width: 7, height: 7, flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, position: "absolute" }} />
        {status === "connected" && (
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, position: "absolute", animation: "sping 1.5s ease-out infinite", opacity: 0 }} />
        )}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: color }}>{label}</span>
      <style>{`@keyframes sping { 0%{transform:scale(1);opacity:0.7} 100%{transform:scale(2.8);opacity:0} }`}</style>
    </div>
  );
}
