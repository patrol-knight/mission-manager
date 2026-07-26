import type { CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApiConnection } from "../../hooks/useApiConnection";
import { useMissionStore } from "../../stores/missionStore";
import { useDeviceStore, selectAnomalyList } from "../../stores/deviceStore";
import { useAnomalyVerify } from "../anomalies/useAnomalyVerify";
import { MissionControls } from "./MissionControls";

const reviewButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#f08c00",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const editButtonStyle: CSSProperties = {
  marginTop: 12,
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "#1c7ed6",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "READY",
  running: "RUNNING",
  paused: "PAUSED",
  returning_home: "RETURNING HOME",
  completed: "COMPLETED",
  investigating: "INVESTIGATING",
};

interface MissionStatusPanelProps {
  onOpenLibrary: () => void;
}

export function MissionStatusPanel({ onOpenLibrary }: MissionStatusPanelProps) {
  const { status } = useApiConnection();
  const definition = useMissionStore((s) => s.definition);
  const execution = useMissionStore((s) => s.execution);
  const anomalies = useDeviceStore(useShallow(selectAnomalyList));
  const { open: openVerify } = useAnomalyVerify();
  // Always derived from anomaly state, never from toast/modal history -- so
  // closing the verify window without deciding can never lose the way back
  // in (see AnomalyVerifyModal's docstring for the bug this fixes).
  const arrivedAnomaly = anomalies.find((a) => a.status === "robot_arrived") ?? null;

  // Editing is blocked only while the robot is executing or returning home
  // (plan §10.1) — ready/completed (or no execution data yet) are editable.
  const canEdit = execution === null || execution.status === "ready" || execution.status === "completed";
  const showEditButton = execution === null || canEdit;

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 13, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Mission Status
      </h3>

      {status !== "connected" ? (
        <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Connecting to backend…</p>
      ) : definition === null ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>No mission loaded</p>
          <button onClick={onOpenLibrary} style={editButtonStyle}>
            New Mission
          </button>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "#212529" }}>{definition.name}</div>
            {execution && (
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1c7ed6", letterSpacing: 0.5 }}>
                {STATUS_LABEL[execution.status]}
              </div>
            )}
          </div>

          {execution === null ? (
            <>
              <Row label="Waypoints" value={String(definition.waypoints.length)} />
              <Row label="Loops" value={String(definition.loopCount)} />
              <Row label="Execution status" value="loading…" />
            </>
          ) : execution.status === "ready" ? (
            <>
              <Row label="Waypoints" value={String(definition.waypoints.length)} />
              <Row label="Loops" value={String(definition.loopCount)} />
            </>
          ) : execution.status === "running" || execution.status === "paused" || execution.status === "investigating" ? (
            <>
              <Row label="Current Loop" value={`${execution.currentLoop} / ${definition.loopCount}`} />
              <Row
                label="Current Waypoint"
                value={`${execution.currentWaypointIndex + 1} / ${definition.waypoints.length}`}
              />
              <Row label="Completed Loops" value={String(execution.completedLoops)} />
            </>
          ) : execution.status === "completed" ? (
            <>
              <Row label="Completed Loops" value={`${execution.completedLoops} / ${definition.loopCount}`} />
              <Row label="Robot" value="At WP1 (Home)" />
            </>
          ) : null}

          {arrivedAnomaly && (
            <button onClick={() => openVerify(arrivedAnomaly.anomalyId)} style={reviewButtonStyle}>
              Review Anomaly
            </button>
          )}

          <MissionControls />

          {showEditButton && (
            <button onClick={onOpenLibrary} disabled={!canEdit} style={editButtonStyle}>
              Edit Mission
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "#6c757d" }}>{label}</span>
      <span style={{ color: "#212529", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
