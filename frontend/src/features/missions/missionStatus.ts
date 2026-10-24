import type { StatusLabel } from "../devices/robotStatus";
import type { MissionExecutionState } from "./missionTypes";

/** Where the mission is in its lifecycle, for its status pill. `suspended`
 * while the robot is away investigating (the mission is frozen meanwhile). */
export function missionStatus(execution: MissionExecutionState | null, suspended: boolean): StatusLabel {
  // All in the mission's orange: full while it moves, soft while it doesn't.
  if (suspended) return { label: "Suspended", tone: "missionSoft", live: false };
  switch (execution?.status) {
    case "running":
      return { label: "Running", tone: "mission", live: true };
    case "paused":
      return { label: "Paused", tone: "missionSoft", live: false };
    case "returning":
      return { label: "Returning", tone: "mission", live: true };
    case "completed":
      return { label: "Completed", tone: "mission", live: false };
    default:
      return { label: "Ready", tone: "missionSoft", live: false };
  }
}

/** Index of the waypoint the robot is heading to. The backend's
 * current_waypoint_index is the last one *reached*; returning always heads
 * to waypoint 0. Null when the robot isn't driving the mission. */
export function targetWaypointIndex(execution: MissionExecutionState | null, waypointCount: number): number | null {
  if (!execution || waypointCount === 0) return null;
  if (execution.status === "returning") return 0;
  if (execution.status === "running" || execution.status === "paused") {
    return (execution.currentWaypointIndex + 1) % waypointCount;
  }
  return null;
}

export interface ProgressRow {
  /** Number of steps; null for an open-ended run. */
  total: number | null;
  /** Steps completed -- a segment fills only once its step is done. */
  done: number;
  fraction: string;
  label: string;
}

/**
 * The mission card's two progress bars.
 *
 * Waypoints: one segment per leg of the loop (WP 1 -> 2, 2 -> 3, ..., and
 * back to 1), filled once the robot reaches the leg's end -- heading from 1
 * to 2 shows nothing filled, reaching 2 fills the first segment. Starts
 * over every loop.
 *
 * Loops: a segment per loop, filled once that loop is finished. An
 * infinite mission has no total: just the number of the loop it's on.
 */
export function missionProgress(
  waypointCount: number,
  loops: { loopCount: number; infiniteLoop: boolean },
  execution: MissionExecutionState | null,
): { waypoints: ProgressRow; loops: ProgressRow } {
  const n = waypointCount;
  const status = execution?.status ?? "ready";
  const driving = status === "running" || status === "paused";
  const target = targetWaypointIndex(execution, n);

  let legsDone = 0;
  if (driving && target !== null) {
    // Heading to waypoint `target`: every leg before it is done; heading
    // back to waypoint 1 (target 0) means all but the closing leg are.
    legsDone = target === 0 ? n - 1 : target - 1;
  } else if (status === "completed") {
    legsDone = n;
  }
  const waypoints: ProgressRow = {
    total: n,
    done: legsDone,
    fraction: `${legsDone}/${n}`,
    label:
      driving && target !== null
        ? `Heading to waypoint ${target + 1} -- ${legsDone} of ${n} legs done this loop`
        : status === "returning"
          ? "Returning to waypoint 1"
          : `${legsDone} of ${n} legs done`,
  };

  const completed = execution?.completedLoops ?? 0;
  const currentLoop = execution?.currentLoop ?? 0;
  const loopRow: ProgressRow = loops.infiniteLoop
    ? {
        total: null,
        done: completed,
        // No end to count towards: just the loop number.
        fraction: String(driving ? currentLoop : completed),
        label: driving ? `Loop ${currentLoop}, repeats until stopped` : `${completed} loops done, repeats until stopped`,
      }
    : {
        total: loops.loopCount,
        done: completed,
        fraction: `${completed}/${loops.loopCount}`,
        label: `${completed} of ${loops.loopCount} loops done`,
      };

  return { waypoints, loops: loopRow };
}
