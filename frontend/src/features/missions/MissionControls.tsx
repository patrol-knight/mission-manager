import { useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useMissionStore } from "../../stores/missionStore";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useApiConnection } from "../../hooks/useApiConnection";
import { connectivityStatus } from "../../types/domain";
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

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
  background: "#adb5bd",
  color: "#f1f3f5",
};

function withDisabled(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, ...disabledStyle } : style;
}

/** Renders the Start/Pause/Resume/Stop controls for whatever the current
 * execution status is. Only mission controls — Edit/New Mission entry lives
 * in MissionStatusPanel since it's available in more statuses than these are. */
export function MissionControls() {
  const execution = useMissionStore((s) => s.execution);
  const setExecution = useMissionStore((s) => s.setExecution);
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const { status: wsStatus } = useApiConnection();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  if (!execution) return null;

  const backendConnected = wsStatus === "connected";
  const hasConnectedRobot =
    backendConnected && devices.some((d) => d.type === "robot" && connectivityStatus(d) === "connected");
  const startTitle = hasConnectedRobot ? undefined : "Connect a robot device before starting a mission";

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
        <button
          disabled={pending || !hasConnectedRobot}
          onClick={() => run(startMission, "Start")}
          style={withDisabled(primary, pending || !hasConnectedRobot)}
          title={startTitle}
        >
          Start Mission
        </button>
      );

    case "running":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(pauseMission, "Pause")} style={withDisabled(neutral, pending)}>
            Pause
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={withDisabled(danger, pending)}>
            Stop
          </button>
        </div>
      );

    case "paused":
      return (
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={pending} onClick={() => run(resumeMission, "Resume")} style={withDisabled(primary, pending)}>
            Resume
          </button>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={withDisabled(danger, pending)}>
            Stop
          </button>
        </div>
      );

    case "returning_home":
      return <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Robot is returning to WP1. Controls disabled.</p>;

    case "investigating":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>
            Robot is investigating an anomaly. Pause/Resume disabled.
          </p>
          <button disabled={pending} onClick={() => run(stopMission, "Stop")} style={withDisabled(danger, pending)}>
            Stop
          </button>
        </div>
      );

    case "completed":
      // The backend only reports "completed" for a moment before resetting
      // straight to "ready" (see mission_execution.py::_finish_mission) --
      // this renders identically to ready as a defensive fallback in case a
      // client catches that brief window, rather than as a real lingering
      // status of its own.
      return (
        <button
          disabled={pending || !hasConnectedRobot}
          onClick={() => run(startMission, "Start")}
          style={withDisabled(primary, pending || !hasConnectedRobot)}
          title={startTitle}
        >
          Start Mission
        </button>
      );
  }
}
