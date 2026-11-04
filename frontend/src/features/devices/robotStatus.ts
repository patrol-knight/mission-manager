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

/** The only states the robot can take a mission in; anything else, a
 * missing state included, is treated as not ready. */
const AVAILABLE_STATES = ["idle", "navigating", "arrived"];

/** Whether a person is driving: state_machine's `status.mode`, or Autoware's
 * own "manual" operational_state. */
export function isManual(robot: Device | null): boolean {
  return robot?.status?.mode === "manual" || operationalState(robot) === "manual";
}

/** Who drives the robot, for its mode pill: Auto or Manual. */
export function robotMode(robot: Device | null): StatusLabel {
  if (isManual(robot)) return { label: "Manual", tone: "warning", live: false };
  const mode = robot?.status?.mode;
  return mode === "auto" || mode === "none"
    ? { label: "Auto", tone: "accent", live: false }
    : { label: "No mode", tone: "muted", live: false };
}

/** Why the robot can't take a mission right now; null when it can. */
export function robotUnavailableHint(robot: Device | null): string | null {
  if (!robot) return "The robot is offline";
  if (isManual(robot)) return "The robot is in manual mode";
  const state = operationalState(robot);
  if (state === "failure") return FAILURE_HINT;
  return state !== null && AVAILABLE_STATES.includes(state) ? null : "The robot is not ready";
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
