import type { MissionDefinition, MissionExecutionState } from "../missions/missionTypes";

/** Where the robot goes when an investigation ends -- mirrors the backend's
 * InvestigationCoordinator._hand_back (README "Mission & Investigation State
 * Machines"). The mission is frozen during an investigation, so the current
 * mission state predicts the outcome before the operator presses Stop/Finish. */
export type FallbackKind = "route" | "start" | "hold";

export interface Fallback {
  kind: FallbackKind;
  /** Short "what happens next" line for the status bar. */
  nextLabel: string;
  /** Toast once the investigation has ended. */
  doneMessage: string;
}

export function fallbackAfterInvestigation(
  execution: MissionExecutionState | null,
  definition: MissionDefinition | null,
): Fallback {
  const hasRoute = execution !== null && definition !== null && definition.waypoints.length > 0;
  if (hasRoute && (execution.status === "running" || execution.status === "paused")) {
    return {
      kind: "route",
      nextLabel: execution.status === "paused" ? "resume the mission" : "back to the route",
      doneMessage:
        execution.status === "paused" ? "Mission resumed, back on the route" : "Back on the mission route",
    };
  }
  if (hasRoute) {
    return { kind: "start", nextLabel: "return to start", doneMessage: "Returning to start (WP 1)" };
  }
  return { kind: "hold", nextLabel: "stay here", doneMessage: "No mission, the robot is holding its position" };
}
