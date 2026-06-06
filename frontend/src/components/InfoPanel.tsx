// components/InfoPanel.tsx
import * as React from "react";
import { useEffect, useRef } from "react";
import type { RobotPose } from "../types";
import type { RouteProgress } from "../stores/waypointStore";

const SPEED_HISTORY = 10;

function dist2D(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function fmtDist(m: number) {
  return m >= 1000 ? (m / 1000).toFixed(2) + " km" : m.toFixed(1) + " m";
}

function fmtEta(sec: number | null) {
  if (sec === null) return "—";
  if (sec >= 3600) return Math.round(sec / 3600) + " hr";
  if (sec >= 60)   return Math.round(sec / 60) + " min";
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

// ─── shared primitives ───────────────────────────────────────────────────────

const GREEN = "#2ecc71";
const ORANGE = "#FF8C00";
const MUTED  = "#6c757d";
const DIVIDER_COLOR = "#e9ecef";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 10,
      overflow: "hidden",
      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    }}>
      <div style={{
        padding: "8px 14px",
        borderBottom: `1px solid ${DIVIDER_COLOR}`,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: MUTED,
          textTransform: "uppercase", letterSpacing: "0.07em",
          fontFamily: "sans-serif",
        }}>
          {title}
        </span>
      </div>
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 5, fontFamily: "monospace", fontSize: 13 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: color ?? "#212529", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ borderTop: `1px solid ${DIVIDER_COLOR}`, margin: "3px 0" }} />;
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: MUTED, marginTop: 3, marginBottom: 1, textTransform: "uppercase", letterSpacing: "0.08em" }}>
      {children}
    </div>
  );
}

// ─── Robot Pose ───────────────────────────────────────────────────────────────

function RobotPoseCard({ pose }: { pose: RobotPose | null }) {
  return (
    <Card title="Robot Pose">
      <Row label="x"     value={pose?.lat != null ? pose.lat.toFixed(6)                     : "—"} color={GREEN} />
      <Row label="y"     value={pose?.lon != null ? pose.lon.toFixed(6)                     : "—"} color={GREEN} />
      <Row label="heading"   value={pose ? (pose.yaw * 180 / Math.PI).toFixed(1) + "°"          : "—"} color={GREEN} />
      <Row label="velocity" value={pose?.speed != null ? Math.abs(pose.speed).toFixed(2) + " m/s" : "—"} color={GREEN} />
    </Card>
  );
}

// ─── Route Progress ───────────────────────────────────────────────────────────
function RouteProgressCard({ routeProgress, robotPose }: { routeProgress: RouteProgress | null; robotPose: RobotPose | null }) {
  const speedBufRef = useRef<number[]>([]);

  useEffect(() => {
    speedBufRef.current = [];
  }, [routeProgress?.currentGoalIdx]);

  const stats = React.useMemo(() => {
    if (!routeProgress || !robotPose || routeProgress.goals.length === 0 || routeProgress.routeCoords.length < 2)
      return null;

    const { currentGoalIdx, goals, routeCoords } = routeProgress;
    const rx = robotPose.x, ry = robotPose.y;

    // smoothed speed
    const sample = Math.abs(robotPose.speed ?? 0);
    if (sample > 0.05) {
      speedBufRef.current.push(sample);
      if (speedBufRef.current.length > SPEED_HISTORY) speedBufRef.current.shift();
    }
    const avg = speedBufRef.current.length > 0
      ? speedBufRef.current.reduce((a, b) => a + b, 0) / speedBufRef.current.length
      : 0;

    if (currentGoalIdx >= goals.length) return { arrived: true, distNext: 0, distTotal: 0, avg };

    const { seg: goalSeg } = projectOntoRoute(goals[currentGoalIdx].x, goals[currentGoalIdx].y, routeCoords);
    const { seg: robotSeg, t: robotT } = projectOntoRoute(rx, ry, routeCoords);

    let distNext: number;
    if (robotSeg >= goalSeg) {
      distNext = dist2D(rx, ry, goals[currentGoalIdx].x, goals[currentGoalIdx].y);
    } else {
      const ax = routeCoords[robotSeg].x, ay = routeCoords[robotSeg].y;
      const bx = routeCoords[robotSeg + 1].x, by = routeCoords[robotSeg + 1].y;
      distNext = dist2D(ax + robotT * (bx - ax), ay + robotT * (by - ay), bx, by);
      for (let i = robotSeg + 1; i < goalSeg; i++)
        distNext += dist2D(routeCoords[i].x, routeCoords[i].y, routeCoords[i + 1].x, routeCoords[i + 1].y);
      distNext += dist2D(routeCoords[goalSeg].x, routeCoords[goalSeg].y, goals[currentGoalIdx].x, goals[currentGoalIdx].y);
    }

    const { seg, t } = projectOntoRoute(rx, ry, routeCoords);
    const distTotal = pathDistFromProjection(seg, t, routeCoords);

    return { arrived: false, avg, distNext, distTotal };
  }, [routeProgress, robotPose]);

  const eta = (dist: number) => fmtEta(stats && stats.avg > 0.1 ? dist / stats.avg : null);

  return (
    <Card title="Route Progress">
      <Section>Next goal</Section>
      <Row label="distance" value={stats && !stats.arrived ? fmtDist(stats.distNext) : "—"} color={ORANGE} />
      <Row label="eta"      value={stats && !stats.arrived ? eta(stats.distNext)      : "—"} color={ORANGE} />
      <Divider />
      <Section>total progress</Section>
      <Row label="distance" value={stats ? fmtDist(stats.distTotal) : "—"} color={ORANGE} />
      <Row label="eta"      value={stats ? eta(stats.distTotal)      : "—"} color={ORANGE} />
    </Card>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export interface InfoPanelProps {
  robotPose:     RobotPose | null;
  routeProgress: RouteProgress | null;
}

export function InfoPanel({ robotPose, routeProgress }: InfoPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <RobotPoseCard pose={robotPose} />
      <RouteProgressCard routeProgress={routeProgress} robotPose={robotPose} />
    </div>
  );
}
