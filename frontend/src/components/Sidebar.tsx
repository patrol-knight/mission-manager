import * as React from "react";
import { useWaypointStore } from "../stores/waypointStore";
import { useApiConnection } from "../hooks/useApiConnection";
import type { Mode, RobotPose } from "../types";
import type { RouteProgress } from "../stores/waypointStore";

const MODES: { key: Mode; label: string; description: string; gradient: string }[] = [
  { key: "off",    label: "Off",    description: "No interaction with map",                          gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  { key: "modify", label: "Modify", description: "Click empty space to add, drag waypoint to move", gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" },
  { key: "delete", label: "Delete", description: "Click waypoint to delete",                        gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)" },
];

const ITEM_HEIGHT = 48;
const GAP = 4;

const SPEED_HISTORY = 5;
const speedBuf: number[] = [];

function smoothedSpeed(sample: number): number {
  speedBuf.push(sample);
  if (speedBuf.length > SPEED_HISTORY) speedBuf.shift();
  return speedBuf.reduce((a, b) => a + b, 0) / speedBuf.length;
}

function dist2D(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function fmtDist(m: number) {
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : m.toFixed(1) + " m";
}

function fmtEta(sec: number | null) {
  if (sec === null) return "—";
  if (sec >= 3600) return Math.round(sec / 3600) + " hr";
  if (sec >= 60) return Math.round(sec / 60) + " min";
  return Math.round(sec) + " s";
}

function projectOntoRoute(rx: number, ry: number, coords: { x: number; y: number }[]) {
  let bestDist = Infinity, bestSeg = 0, bestT = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i].x, ay = coords[i].y;
    const bx = coords[i + 1].x, by = coords[i + 1].y;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((rx - ax) * dx + (ry - ay) * dy) / lenSq)) : 0;
    const d = dist2D(rx, ry, ax + t * dx, ay + t * dy);
    if (d < bestDist) { bestDist = d; bestSeg = i; bestT = t; }
  }
  return { seg: bestSeg, t: bestT };
}

function pathDistFromProjection(seg: number, t: number, coords: { x: number; y: number }[]) {
  const ax = coords[seg].x, ay = coords[seg].y;
  const bx = coords[seg + 1].x, by = coords[seg + 1].y;
  let total = dist2D(ax + t * (bx - ax), ay + t * (by - ay), bx, by);
  for (let i = seg + 1; i < coords.length - 1; i++) {
    total += dist2D(coords[i].x, coords[i].y, coords[i + 1].x, coords[i + 1].y);
  }
  return total;
}

interface SidebarProps {
  onConfirm: () => void;
  robotPose: RobotPose | null;
  onClearRoute: () => void;
  routeProgress: RouteProgress | null;
}

export function Sidebar({ onConfirm, robotPose, onClearRoute, routeProgress }: SidebarProps) {
  const waypoints = useWaypointStore((s) => s.waypoints);
  const mode = useWaypointStore((s) => s.mode);
  const setMode = useWaypointStore((s) => s.setMode);
  const { status } = useApiConnection();
  const modeIndex = MODES.findIndex((m) => m.key === mode);
  const hasWaypoints = waypoints.length > 0;

  const stats = React.useMemo(() => {
    if (!routeProgress || !robotPose || routeProgress.goals.length === 0 || routeProgress.routeCoords.length < 2) return null;
    const { currentGoalIdx, goals, routeCoords } = routeProgress;
    const rx = robotPose.x, ry = robotPose.y;
    const avg = smoothedSpeed(Math.abs(robotPose.speed ?? 0));

    if (currentGoalIdx >= goals.length) {
      return { arrived: true, distNext: 0, distTotal: 0, avg, goalLabel: "Arrived" };
    }

    const { seg: goalSeg } = projectOntoRoute(goals[currentGoalIdx].x, goals[currentGoalIdx].y, routeCoords);
    const { seg: robotSeg, t: robotT } = projectOntoRoute(rx, ry, routeCoords);

    let distNext: number;
    if (robotSeg >= goalSeg) {
      distNext = dist2D(rx, ry, goals[currentGoalIdx].x, goals[currentGoalIdx].y);
    } else {
      const ax = routeCoords[robotSeg].x, ay = routeCoords[robotSeg].y;
      const bx = routeCoords[robotSeg + 1].x, by = routeCoords[robotSeg + 1].y;
      distNext = dist2D(ax + robotT * (bx - ax), ay + robotT * (by - ay), bx, by);
      for (let i = robotSeg + 1; i < goalSeg; i++) {
        distNext += dist2D(routeCoords[i].x, routeCoords[i].y, routeCoords[i + 1].x, routeCoords[i + 1].y);
      }
      distNext += dist2D(routeCoords[goalSeg].x, routeCoords[goalSeg].y, goals[currentGoalIdx].x, goals[currentGoalIdx].y);
    }

    const { seg, t } = projectOntoRoute(rx, ry, routeCoords);
    const distTotal = pathDistFromProjection(seg, t, routeCoords);

    return {
      arrived: false,
      avg,
      distNext,
      distTotal,
      goalLabel: `${currentGoalIdx + 1} / ${goals.length}`,
    };
  }, [routeProgress, robotPose]);

  return (
    <div style={{
      width: "20%", minWidth: 280, maxWidth: 400,
      padding: 20,
      background: "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
      overflowY: "auto",
      boxShadow: "4px 0 12px rgba(0,0,0,0.08)",
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "#212529" }}>Mission Editor</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusPill label="Backend" status={status} />
          <StatusPill label="Robot" status={robotPose !== null ? "connected" : "disconnected"} />
        </div>
      </div>

      <div>
        <SectionLabel>Mode</SectionLabel>
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
          onClick={onConfirm}
          disabled={!hasWaypoints}
          style={{
            flex: 1, padding: "12px 16px", color: "white", border: "none",
            borderRadius: 10, cursor: !hasWaypoints ? "not-allowed" : "pointer",
            fontSize: 14, fontWeight: 600,
            background: !hasWaypoints ? "#adb5bd" : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            boxShadow: !hasWaypoints ? "none" : "0 4px 12px rgba(102,126,234,0.4)",
            transition: "all 0.3s ease",
          }}
          onMouseEnter={(e) => { if (hasWaypoints) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 6px 16px rgba(102,126,234,0.5)"; } }}
          onMouseLeave={(e) => { if (hasWaypoints) { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 12px rgba(102,126,234,0.4)"; } }}
        >
          Confirm Route ({waypoints.length})
        </button>
        <button
          onClick={onClearRoute}
          style={{
            padding: "12px 14px", background: "#fff",
            color: "#dc3545", border: "1px solid #f5c6cb",
            borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)", transition: "all 0.2s", whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#fff5f5"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >Clear</button>
      </div>

      <RouteProgressCard stats={stats} routeProgress={routeProgress} />

      <div style={{ flex: 1 }} />
    </div>
  );
}

interface RouteStats {
  arrived: boolean;
  avg: number;
  distNext: number;
  distTotal: number;
  goalLabel: string;
}

function RouteProgressCard({ stats, routeProgress }: { stats: RouteStats | null; routeProgress: RouteProgress | null }) {
  const [expanded, setExpanded] = React.useState(false);

  const isActive = routeProgress?.active ?? false;

  return (
    <div style={{ background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          padding: "12px 16px",
          background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
          cursor: "pointer", display: "flex", justifyContent: "space-between",
          alignItems: "center", userSelect: "none",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: "#495057" }}>Route Progress</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* {isActive && (
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#FF8C00",
              boxShadow: "0 0 0 0 rgba(255,140,0,0.4)",
              animation: "rpulse 1.2s infinite",
            }} />
          )} */}
          <span style={{
            fontSize: 10, color: expanded ? "#495057" : "#adb5bd",
            transition: "color 0.2s",
          }}>●</span>
        </div>
      </div>

      <div style={{
        maxHeight: expanded ? "300px" : "0",
        overflow: "hidden",
        transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}>
        <div style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13 }}>
          {!isActive || !stats ? (
            <NoRouteRows />
          ) : stats.arrived ? (
            <ArrivedRows />
          ) : (
            <ActiveRows stats={stats} />
          )}
        </div>
      </div>

      <style>{`@keyframes rpulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,140,0,0.5)} 50%{box-shadow:0 0 0 5px rgba(255,140,0,0)} }`}</style>
    </div>
  );
}

function NoRouteRows() {
  return (
    <>
      <RPRow label="Goal" value="—" />
      
      <RPDivider />
      <RPSection>▸ next goal</RPSection>
      <RPRow label="Distance" value="—" />
      <RPRow label="ETA" value="—" />
      <RPDivider />
      <RPSection>▸ total remaining</RPSection>
      <RPRow label="Distance" value="—" />
      <RPRow label="ETA" value="—" />
    </>
  );
}

function ArrivedRows() {
  return (
    <>
      <RPRow label="Goal" value="Arrived" orange />
      
      <RPDivider />
      <RPSection>▸ next goal</RPSection>
      <RPRow label="Distance" value="—" orange />
      <RPRow label="ETA" value="—" orange />
      <RPDivider />
      <RPSection>▸ total remaining</RPSection>
      <RPRow label="Distance" value="0.0 m" orange />
      <RPRow label="ETA" value="—" orange />
    </>
  );
}

function ActiveRows({ stats }: { stats: RouteStats }) {
  return (
    <>
      <RPRow label="Goal" value={stats.goalLabel} orange />
      
      <RPDivider />
      <RPSection>▸ next goal</RPSection>
      <RPRow label="Distance" value={fmtDist(stats.distNext)} orange />
      <RPRow label="ETA" value={fmtEta(stats.avg > 0.1 ? stats.distNext / stats.avg : null)} orange />
      <RPDivider />
      <RPSection>▸ total remaining</RPSection>
      <RPRow label="Distance" value={fmtDist(stats.distTotal)} orange />
      <RPRow label="ETA" value={fmtEta(stats.avg > 0.1 ? stats.distTotal / stats.avg : null)} orange />
    </>
  );
}

function RPRow({ label, value, orange }: { label: string; value: string; orange?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, margin: "3px 0" }}>
      <span style={{ color: "#6c757d" }}>{label}</span>
      <span style={{ color: orange ? "#FF8C00" : "#495057", textAlign: "right" }}>{value}</span>
    </div>
  );
}

function RPDivider() {
  return <div style={{ borderTop: "1px solid #e9ecef", margin: "6px 0" }} />;
}

function RPSection({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: "#adb5bd", margin: "5px 0 2px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
      {children}
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
  const color =
    status === "connected" ? "#28a745" :
    status === "connecting" ? "#ffc107" :
    "#dc3545";

  const textColor =
    status === "connected" ? "#155724" :
    status === "connecting" ? "#856404" :
    "#721c24";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <div style={{ position: "relative", width: 7, height: 7, flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, position: "absolute" }} />
        {status === "connected" && (
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, position: "absolute", animation: "sping 1.5s ease-out infinite", opacity: 0 }} />
        )}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: textColor }}>{label}</span>
      <style>{`@keyframes sping { 0%{transform:scale(1);opacity:0.7} 100%{transform:scale(2.8);opacity:0} }`}</style>
    </div>
  );
}
