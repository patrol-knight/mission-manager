import { useEffect, useState } from "react";
import type { PillTone } from "../../components/ui/Pill";
import type { Investigation } from "../investigation/investigationTypes";
import { dwellLeft, type MissionExecutionState } from "../missions/missionTypes";
import { formatCountdown } from "../missions/missionSummaryFormat";
import type { Device } from "../../types/domain";

export const FAILURE_HINT = "Please adjust the robot";

/** Outlasts the `ready` between two waypoints. */
const READY_SETTLE_MS = 1000;
const DRIVING_STATES = ["navigating", "blocked", "arrived"];

export interface StatusLabel {
  label: string;
  tone: PillTone;
  /** Live states get a dot. */
  live: boolean;
}

function statusField(robot: Device | null, key: string): string | null {
  const value = robot?.status?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** state_machine's `status.state`: notready / ready / navigating / arrived / failure. */
export function robotState(robot: Device | null): string | null {
  return statusField(robot, "state");
}

/** robotState, without the brief `ready` between two waypoints. */
export function useSettledRobotState(robot: Device | null): string | null {
  const state = robotState(robot);
  const [settled, setSettled] = useState(state);
  const holding = state === "ready" && settled !== null && DRIVING_STATES.includes(settled);
  if (!holding && settled !== state) setSettled(state);
  useEffect(() => {
    if (!holding) return;
    const timer = setTimeout(() => setSettled(state), READY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [holding, state]);
  return holding ? settled : state;
}

/** The only states the robot can take a mission in; anything else, a
 * missing state included, is treated as not ready. */
const AVAILABLE_STATES = ["ready", "navigating", "blocked", "arrived"];

const REASON_HINTS: Record<string, string> = {
  autoware_unavailable: "Autoware is not running",
  not_localized: "The robot is not localized",
  lidar_stale: "No LiDAR data",
  imu_stale: "No IMU data",
  odom_stale: "No wheel odometry",
  status_stale: "No status from the robot",
  not_moving: "The robot stopped moving. Drive it with RC, then Resume",
};

/** Who drives the robot, for its mode pill; null, so no pill, while nobody does. */
export function robotMode(robot: Device | null): StatusLabel | null {
  switch (statusField(robot, "mode")) {
    case "estop":
      return { label: "E-stop", tone: "danger", live: false };
    case "manual":
      return { label: "Manual", tone: "warning", live: false };
    case "auto":
      return { label: "Auto", tone: "accent", live: false };
  }
  return null;
}

/** Why the robot can't take a mission right now; null when it can. */
export function robotUnavailableHint(robot: Device | null): string | null {
  if (!robot) return "The robot is offline";
  const mode = statusField(robot, "mode");
  if (mode === "estop") return "The emergency stop is pressed";
  if (mode === "manual") return "The robot is in manual mode";
  const state = robotState(robot);
  if (state !== null && AVAILABLE_STATES.includes(state)) return null;
  const reason = statusField(robot, "reason");
  const hint = reason ? REASON_HINTS[reason] : undefined;
  return hint ?? (state === "failure" ? FAILURE_HINT : "The robot is not ready");
}

/** What the robot is doing right now, for its status pill -- colored by
 * the mode it's in (orange mission, yellow investigation; a camera check is
 * an investigation too). No live dot: whether the robot is up is the
 * connection pill's job. Who drives is robotMode's pill. Dwelling at a
 * waypoint counts down, as of `now`. */
export function robotStatus(
  robotConnected: boolean,
  investigation: Investigation | null,
  execution: MissionExecutionState | null,
  state: string | null,
  now: number = Date.now(),
): StatusLabel {
  const label = (text: string, tone: PillTone): StatusLabel => ({ label: text, tone, live: false });
  if (!robotConnected) return label("Offline", "danger");
  if (state === "failure") return label("Failure", "danger");
  if (state === null || !AVAILABLE_STATES.includes(state)) return label("Not ready", "muted");
  if (state === "blocked") return label("Blocked", "warning");
  if (investigation) return label(investigation.phase === "en_route" ? "En route" : "On site", "investigate");
  switch (execution?.status) {
    case "running": {
      const left = dwellLeft(execution, now);
      if (left !== null) return label(`Dwell ${formatCountdown(left)}`, "mission");
      return state === "ready" ? label("Waiting", "missionSoft") : label("Patrolling", "mission");
    }
    case "paused":
      return label("Holding", "missionSoft");
  }
  return state === "navigating" ? label("Patrolling", "mission") : label("Ready", "success");
}
