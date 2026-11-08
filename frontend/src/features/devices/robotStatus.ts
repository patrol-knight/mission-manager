import { useEffect, useState } from "react";
import type { PillTone } from "../../components/ui/Pill";
import type { Investigation } from "../investigation/investigationTypes";
import type { MissionExecutionState } from "../missions/missionTypes";
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
  if (state === "blocked") return { label: "Blocked", tone: "warning", live: false };
  if (investigation) {
    return investigation.phase === "en_route"
      ? { label: "En route", tone: "investigate", live: true }
      : { label: "On site", tone: "investigate", live: true };
  }
  switch (execution?.status) {
    case "running":
      return state === "ready"
        ? { label: "Waiting", tone: "missionSoft", live: false }
        : { label: "Patrolling", tone: "mission", live: true };
    case "paused":
      return { label: "Holding", tone: "missionSoft", live: false };
  }
  return state === "navigating"
    ? { label: "Patrolling", tone: "mission", live: true }
    : { label: "Ready", tone: "success", live: false };
}
