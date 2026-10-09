import { formatAnomalyTypes, formatConfidence, VERDICT_LABELS, type Anomaly } from "../anomalies/anomalyTypes";
import type { MissionDefinition, MissionExecutionState } from "../missions/missionTypes";
import { fallbackAfterInvestigation } from "./fallback";
import type { Investigation } from "./investigationTypes";

export type ActivityTone = "investigating" | "active" | "idle" | "offline";

export interface RobotActivity {
  title: string;
  detail: string | null;
  /** What happens next, so the operator never has to remember the rules. */
  next: string | null;
  tone: ActivityTone;
}

export interface RobotActivityInput {
  robotConnected: boolean;
  investigation: Investigation | null;
  /** The investigation target, if it is still in the store. */
  target: Anomaly | null;
  /** Straight-line distance from the robot to the target, in meters. */
  distanceM: number | null;
  execution: MissionExecutionState | null;
  definition: MissionDefinition | null;
}

/** One status for the operator, derived from the two internal state machines
 * (mission + investigation) -- docs/investigate-mode-design.md §8.1. */
export function describeRobotActivity(input: RobotActivityInput): RobotActivity {
  const { robotConnected, investigation, target, distanceM, execution, definition } = input;

  if (!robotConnected) {
    return { title: "Robot offline", detail: "Mission editing only", next: null, tone: "offline" };
  }

  if (investigation) {
    const about = target ? `${formatAnomalyTypes(target.types)} · ${formatConfidence(target.confidence)}` : null;
    if (investigation.phase === "en_route") {
      const distance = distanceM !== null ? `${Math.round(distanceM)} m` : null;
      return {
        title: "Heading to anomaly",
        detail: [about, distance].filter(Boolean).join(" · ") || null,
        next: "Verify on arrival",
        tone: "investigating",
      };
    }
    const verdict = investigation.draftVerdict ? VERDICT_LABELS[investigation.draftVerdict] : "not verified";
    return {
      title: "On site",
      detail: `Verdict: ${verdict}`,
      next: `After Finish: ${fallbackAfterInvestigation(execution, definition).nextLabel}`,
      tone: "investigating",
    };
  }

  if (!execution || !definition) {
    return { title: "Idle", detail: "No mission", next: null, tone: "idle" };
  }

  const waypointCount = definition.waypoints.length;
  switch (execution.status) {
    case "running": {
      const nextWaypoint = waypointCount > 0 ? ((execution.currentWaypointIndex + 1) % waypointCount) + 1 : null;
      return {
        title: "Patrolling",
        detail: `Loop ${execution.currentLoop}/${definition.loopCount}${nextWaypoint ? ` → WP ${nextWaypoint}` : ""}`,
        next: null,
        tone: "active",
      };
    }
    case "paused":
      return { title: "Paused", detail: `At WP ${execution.currentWaypointIndex + 1}`, next: null, tone: "idle" };
    case "returning":
      return { title: "Returning to start", detail: "→ WP 1", next: "Idle on arrival", tone: "active" };
    default:
      return { title: "Idle", detail: definition.name, next: null, tone: "idle" };
  }
}
