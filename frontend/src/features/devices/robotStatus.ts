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

/** The robot's own `status.operational_state`, as mapped by its aggregator. */
export function operationalState(robot: Device | null): string | null {
  const state = robot?.status?.operational_state;
  return typeof state === "string" ? state : null;
}

/** Why the robot can't take a mission right now; null when it can. */
export function robotUnavailableHint(robot: Device | null): string | null {
  if (!robot) return "The robot is offline";
  switch (operationalState(robot)) {
    case "failure":
      return FAILURE_HINT;
    case "manual":
      return "The robot is in manual mode";
    case "notready":
      return "The robot is not ready";
    default:
      return null;
  }
}

/** What the robot is doing right now, for its status pill -- colored by
 * the mode it's in (orange mission, yellow investigation). */
export function robotStatus(
  robotConnected: boolean,
  investigation: Investigation | null,
  execution: MissionExecutionState | null,
  state: string | null = null,
): StatusLabel {
  if (!robotConnected) return { label: "Offline", tone: "danger", live: false };
  switch (state) {
    case "failure":
      return { label: "Failure", tone: "danger", live: false };
    case "manual":
      return { label: "Manual", tone: "warning", live: false };
    case "notready":
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
    : { label: "Idle", tone: "success", live: false };
}
