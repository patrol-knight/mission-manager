import { useState } from "react";
import { useMissionStore } from "../../stores/missionStore";
import { useToast } from "../../components/useToast";
import { buttonStyles, withDisabled } from "../../components/styles";
import { startMission, pauseMission, resumeMission, stopMission } from "../../api/missionApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import type { MissionExecutionState } from "./missionTypes";

/** Renders the Start/Pause/Resume/Stop controls for whatever the current
 * execution status is. Only mission controls — Edit/New Mission entry lives
 * in MissionStatusPanel since it's available in more statuses than these are. */
export function MissionControls() {
  const execution = useMissionStore((s) => s.execution);
  const setExecution = useMissionStore((s) => s.setExecution);
  const robot = useConnectedRobot();
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
    case "completed": {
      // "completed" is only broadcast for a moment before the backend resets
      // to "ready" (see mission_execution.py::_finish_mission).
      const disabled = pending || robot === null;
      return (
        <div style={{ display: "flex" }} title={robot ? undefined : "The robot is offline"}>
          <button disabled={disabled} onClick={() => run(startMission, "Start")} style={withDisabled(buttonStyles.primary, disabled)}>
            Start Mission
          </button>
        </div>
      );
    }

    case "running":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(pauseMission, "Pause")} style={withDisabled(buttonStyles.neutral, pending)}>
            Pause
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={withDisabled(buttonStyles.danger, pending)}>
            Stop
          </button>
        </div>
      );

    case "paused":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(resumeMission, "Resume")} style={withDisabled(buttonStyles.primary, pending)}>
            Resume
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={withDisabled(buttonStyles.danger, pending)}>
            Stop
          </button>
        </div>
      );

    case "returning":
      return <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Robot is returning to WP 1. Controls disabled.</p>;
  }
}
