import { useApiConnection } from "../../hooks/useApiConnection";
import { useMissionStore } from "../../stores/missionStore";
import { cardStyle, cardTitleStyle, buttonStyles } from "../../components/styles";
import { MissionControls } from "./MissionControls";
import type { MissionStatus } from "./missionTypes";

const STATUS_LABEL: Record<MissionStatus, string> = {
  ready: "READY",
  running: "RUNNING",
  paused: "PAUSED",
  returning: "RETURNING TO START",
  completed: "COMPLETED",
};

interface MissionStatusPanelProps {
  onOpenLibrary: () => void;
  /** While the robot is investigating, the mission is frozen: show a
   * one-line, read-only strip instead of the card and its controls. */
  collapsed: boolean;
}

export function MissionStatusPanel({ onOpenLibrary, collapsed }: MissionStatusPanelProps) {
  const { status } = useApiConnection();
  const definition = useMissionStore((s) => s.definition);
  const execution = useMissionStore((s) => s.execution);

  if (collapsed) {
    const parts = definition
      ? [
          definition.name,
          execution ? STATUS_LABEL[execution.status] : null,
          "suspended",
          execution && execution.status !== "ready" ? `loop ${execution.currentLoop}/${definition.loopCount}` : null,
        ]
      : ["No mission"];
    return (
      <div
        className="card-enter"
        title="Mission controls are unavailable while the robot is investigating"
        style={{ ...cardStyle, padding: "10px 16px", fontSize: 13, color: "#868e96" }}
      >
        {parts.filter(Boolean).join(" · ")}
      </div>
    );
  }

  // Editing is blocked only while the robot is executing or returning to
  // start — ready/completed (or no execution data yet) are editable.
  const canEdit = execution === null || execution.status === "ready" || execution.status === "completed";

  return (
    <div className="card-enter" style={cardStyle}>
      <h3 style={cardTitleStyle}>Mission Status</h3>

      {status !== "connected" ? (
        <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Connecting to backend…</p>
      ) : definition === null ? (
        <>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>No mission loaded</p>
          <button onClick={onOpenLibrary} style={{ ...buttonStyles.primary, marginTop: 12 }}>
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
          ) : execution.status === "running" || execution.status === "paused" ? (
            <>
              <Row label="Current Loop" value={`${execution.currentLoop} / ${definition.loopCount}`} />
              <Row
                label="Current Waypoint"
                value={`${execution.currentWaypointIndex + 1} / ${definition.waypoints.length}`}
              />
              <Row label="Completed Loops" value={String(execution.completedLoops)} />
            </>
          ) : execution.status === "completed" ? (
            <Row label="Completed Loops" value={`${execution.completedLoops} / ${definition.loopCount}`} />
          ) : (
            <>
              <Row label="Waypoints" value={String(definition.waypoints.length)} />
              <Row label="Loops" value={String(definition.loopCount)} />
            </>
          )}

          <MissionControls />

          {canEdit && (
            <button onClick={onOpenLibrary} style={buttonStyles.primary}>
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
