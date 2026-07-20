import { useState, type CSSProperties } from "react";
import { useMissionStore } from "../../stores/missionStore";
import { useToast } from "../../components/useToast";
import { startMission, pauseMission, resumeMission, stopMission } from "../../api/missionApi";
import type { MissionExecutionState } from "./missionTypes";

const buttonStyle: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const primary: CSSProperties = { ...buttonStyle, background: "#1c7ed6", color: "#fff" };
const danger: CSSProperties = { ...buttonStyle, background: "#fff", color: "#dc3545", border: "1px solid #f5c6cb" };
const neutral: CSSProperties = { ...buttonStyle, background: "#fff", color: "#212529", border: "1px solid #dee2e6" };

/** Renders the Start/Pause/Resume/Stop controls for whatever the current
 * execution status is. Only mission controls — Edit/New Mission entry lives
 * in MissionStatusPanel since it's available in more statuses than these are. */
export function MissionControls() {
  const execution = useMissionStore((s) => s.execution);
  const setExecution = useMissionStore((s) => s.setExecution);
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  if (!execution) return null;

  const run = async (action: () => Promise<MissionExecutionState>, label: string) => {
    setPending(true);
    try {
      setExecution(await action());
    } catch (err) {
      show("error", `${label} failed`, err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  switch (execution.status) {
    case "ready":
      return (
        <button disabled={pending} onClick={() => run(startMission, "Start")} style={primary}>
          Start Mission
        </button>
      );

    case "running":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(pauseMission, "Pause")} style={neutral}>
            Pause
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={danger}>
            Stop
          </button>
        </div>
      );

    case "paused":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(resumeMission, "Resume")} style={primary}>
            Resume
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={danger}>
            Stop
          </button>
        </div>
      );

    case "returning_home":
      return <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Robot is returning to WP1. Controls disabled.</p>;

    case "completed":
      return (
        <button disabled={pending} onClick={() => run(startMission, "Start")} style={primary}>
          Start Again
        </button>
      );
  }
}
