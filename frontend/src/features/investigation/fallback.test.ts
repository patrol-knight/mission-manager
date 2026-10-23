import { describe, it, expect } from "vitest";
import { fallbackAfterInvestigation } from "./fallback";
import type { MissionDefinition, MissionExecutionState, MissionStatus } from "../missions/missionTypes";

const definition = {
  missionId: "m1",
  name: "Mission 1",
  loopCount: 3,
  waypoints: [{}, {}, {}],
} as unknown as MissionDefinition;

function execution(status: MissionStatus, currentWaypointIndex = 1): MissionExecutionState {
  return { missionId: "m1", status, currentLoop: 2, completedLoops: 1, currentWaypointIndex, updatedAt: null };
}

describe("fallbackAfterInvestigation", () => {
  it("goes back to the route when the mission is running or paused", () => {
    expect(fallbackAfterInvestigation(execution("running"), definition).kind).toBe("route");
    const paused = fallbackAfterInvestigation(execution("paused"), definition);
    expect(paused.kind).toBe("route");
    expect(paused.doneMessage).toMatch(/Mission resumed/);
  });

  it("returns to start when the mission is idle or already returning", () => {
    expect(fallbackAfterInvestigation(execution("ready"), definition).kind).toBe("start");
    expect(fallbackAfterInvestigation(execution("returning"), definition).kind).toBe("start");
  });

  it("holds in place without a mission or waypoints", () => {
    expect(fallbackAfterInvestigation(null, null).kind).toBe("hold");
    const empty = { ...definition, waypoints: [] } as MissionDefinition;
    expect(fallbackAfterInvestigation(execution("running"), empty).kind).toBe("hold");
  });
});
