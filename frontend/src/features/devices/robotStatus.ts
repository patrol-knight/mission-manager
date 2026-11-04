import type { PillTone } from "../../components/ui/Pill";
import type { Investigation } from "../investigation/investigationTypes";
import type { MissionExecutionState } from "../missions/missionTypes";
import type { Device } from "../../types/domain";

export const FAILURE_HINT = "Please adjust the robot";

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

/** The only states the robot can take a mission in; anything else, a
 * missing state included, is treated as not ready. */
const AVAILABLE_STATES = ["ready", "navigating", "arrived"];

const REASON_HINTS: Record<string, string> = {
  autoware_unavailable: "Autoware is not running",
  not_localized: "The robot is not localized",
  lidar_stale: "No LiDAR data",
  imu_stale: "No IMU data",
  odom_stale: "No wheel odometry",
  status_stale: "No status from the robot",
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
  if (state === "failure") return FAILURE_HINT;
  if (state !== null && AVAILABLE_STATES.includes(state)) return null;
  const reason = statusField(robot, "reason");
  return (reason && REASON_HINTS[reason]) ?? "The robot is not ready";
}

/** What autonomy is doing right now, for its status pill -- colored by
 * the mode it's in (orange mission, yellow investigation). Who drives is
 * robotMode's pill. */
export function robotStatus(
  robotConnected: boolean,
  investigation: Investigation | null,
  execution: MissionExecutionState | null,
  state: string | null,
): StatusLabel {
  if (!robotConnected) return { label: "Offline", tone: "danger", live: false };
  if (state === "failure") return { label: "Failure", tone: "danger", live: false };
  if (state === null || !AVAILABLE_STATES.includes(state)) {
    return { label: "Not ready", tone: "muted", live: false };
  }
  if (investigation) {
    return investigation.phase === "en_route"
      ? { label: "En route", tone: "investigate", live: true }
      : { label: "On site", tone: "investigate", live: true };
  }
  switch (execution?.status) {
    case "running":
      return { label: "Patrolling", tone: "mission", live: true };
    case "paused":
      return { label: "Holding", tone: "missionSoft", live: false };
  }
  return state === "navigating"
    ? { label: "Patrolling", tone: "mission", live: true }
    : { label: "Ready", tone: "success", live: false };
}
