import { describe, it, expect } from "vitest";
import { robotStatus } from "./robotStatus";
import { missionProgress, missionStatus, targetWaypointIndex } from "../missions/missionStatus";
import type { MissionExecutionState, MissionStatus } from "../missions/missionTypes";
import type { Investigation } from "../investigation/investigationTypes";

function execution(status: MissionStatus, currentWaypointIndex = 1): MissionExecutionState {
  return { missionId: "m1", status, currentLoop: 2, completedLoops: 1, currentWaypointIndex, updatedAt: null };
}

const investigation = { anomalyId: "a1", phase: "en_route" } as Investigation;

describe("robotStatus", () => {
  it("reports an offline robot before anything else", () => {
    expect(robotStatus(false, investigation, execution("running")).label).toBe("Offline");
  });

  it("shows the investigation phase over the mission", () => {
    expect(robotStatus(true, investigation, execution("running")).label).toBe("En route");
    expect(robotStatus(true, { ...investigation, phase: "on_site" }, null).label).toBe("On site");
  });

  it("follows the mission otherwise", () => {
    expect(robotStatus(true, null, execution("running")).label).toBe("Patrolling");
    expect(robotStatus(true, null, execution("returning")).label).toBe("Returning");
    expect(robotStatus(true, null, execution("paused")).label).toBe("Holding");
    expect(robotStatus(true, null, execution("ready")).label).toBe("Idle");
    expect(robotStatus(true, null, null).label).toBe("Idle");
  });
});

describe("missionStatus", () => {
  it("is suspended during an investigation whatever the execution says", () => {
    expect(missionStatus(execution("running"), true).label).toBe("Suspended");
  });

  it("names each execution status", () => {
    expect(missionStatus(execution("running"), false).label).toBe("Running");
    expect(missionStatus(execution("paused"), false).label).toBe("Paused");
    expect(missionStatus(null, false).label).toBe("Ready");
  });
});

describe("targetWaypointIndex", () => {
  it("is the waypoint after the last reached one, wrapping around", () => {
    expect(targetWaypointIndex(execution("running", 0), 3)).toBe(1);
    expect(targetWaypointIndex(execution("running", 2), 3)).toBe(0);
  });

  it("is the start while returning, and nothing while idle", () => {
    expect(targetWaypointIndex(execution("returning", 2), 3)).toBe(0);
    expect(targetWaypointIndex(execution("ready"), 3)).toBeNull();
  });
});

describe("missionProgress", () => {
  const finite = { loopCount: 2, infiniteLoop: false };
  const infinite = { loopCount: 1, infiniteLoop: true };

  it("starts empty while ready", () => {
    const { waypoints, loops } = missionProgress(3, finite, { ...execution("ready"), completedLoops: 0 });
    expect(waypoints).toMatchObject({ done: 0, fraction: "0/3" });
    expect(loops).toMatchObject({ done: 0, fraction: "0/2" });
  });

  it("fills a leg only once its end is reached", () => {
    // Just left waypoint 1 (index 0), heading to 2: nothing done yet.
    expect(missionProgress(3, finite, execution("running", 0)).waypoints).toMatchObject({ done: 0, fraction: "0/3" });
    // Reached waypoint 2, heading to 3: the first leg is done.
    expect(missionProgress(3, finite, execution("running", 1)).waypoints).toMatchObject({ done: 1, fraction: "1/3" });
    // Reached 3, closing the loop back to 1: all but the last leg.
    expect(missionProgress(3, finite, execution("running", 2)).waypoints).toMatchObject({ done: 2, fraction: "2/3" });
  });

  it("fills a loop only once it is finished", () => {
    const { loops } = missionProgress(3, finite, { ...execution("running"), currentLoop: 2, completedLoops: 1 });
    expect(loops).toMatchObject({ done: 1, fraction: "1/2" });
  });

  it("shows just the loop number for an infinite mission", () => {
    expect(missionProgress(3, infinite, execution("running")).loops).toMatchObject({ total: null, fraction: "2" });
    expect(missionProgress(3, infinite, execution("ready")).loops.fraction).toBe("1");
  });
});
