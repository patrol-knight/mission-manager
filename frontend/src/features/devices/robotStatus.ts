import type { PillTone } from "../../components/ui/Pill";
import type { Investigation } from "../investigation/investigationTypes";
import type { MissionExecutionState } from "../missions/missionTypes";

export interface StatusLabel {
  label: string;
  tone: PillTone;
  /** Live states get a dot. */
  live: boolean;
}

/** What the robot is doing right now, for its status pill -- colored by
 * the mode it's in (orange mission, yellow investigation). Derived from the
 * investigation and mission state machines until the robot reports its own
 * operational state. */
export function robotStatus(
  robotConnected: boolean,
  investigation: Investigation | null,
  execution: MissionExecutionState | null,
): StatusLabel {
  if (!robotConnected) return { label: "Offline", tone: "danger", live: false };
  if (investigation) {
    return investigation.phase === "en_route"
      ? { label: "En route", tone: "investigate", live: true }
      : { label: "On site", tone: "investigate", live: true };
  }
  switch (execution?.status) {
    case "running":
      return { label: "Patrolling", tone: "mission", live: true };
    case "returning":
      return { label: "Returning", tone: "mission", live: true };
    case "paused":
      return { label: "Holding", tone: "missionSoft", live: false };
    default:
      return { label: "Idle", tone: "success", live: false };
  }
}
