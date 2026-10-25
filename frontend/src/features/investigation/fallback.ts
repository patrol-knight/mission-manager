import type { MissionDefinition, MissionExecutionState } from "../missions/missionTypes";

/** Where the robot goes when an investigation ends -- mirrors the backend's
 * InvestigationCoordinator._hand_back. The mission is frozen during an
 * investigation, so its state predicts the outcome. */
export type FallbackKind = "route" | "hold";

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
  return { kind: "hold", nextLabel: "stay here", doneMessage: "The robot is holding its position" };
}
