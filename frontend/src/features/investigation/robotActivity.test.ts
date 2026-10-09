import { describe, it, expect } from "vitest";
import { describeRobotActivity, type RobotActivityInput } from "./robotActivity";
import { fallbackAfterInvestigation } from "./fallback";
import type { MissionDefinition, MissionExecutionState, MissionStatus } from "../missions/missionTypes";
import type { Investigation } from "./investigationTypes";
import type { Anomaly } from "../anomalies/anomalyTypes";

const definition = {
  missionId: "m1",
  name: "Mission 1",
  loopCount: 3,
  waypoints: [{}, {}, {}],
} as unknown as MissionDefinition;

function execution(status: MissionStatus, currentWaypointIndex = 1): MissionExecutionState {
  return { missionId: "m1", status, currentLoop: 2, completedLoops: 1, currentWaypointIndex, updatedAt: null };
}

const investigation: Investigation = {
  anomalyId: "a1",
  robotDeviceId: "robot-1",
  phase: "en_route",
  target: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
  draftVerdict: null,
  startedAt: "2026-10-08T00:00:00Z",
  arrivedAt: null,
};

const target = { types: ["lying_down"], confidence: 0.92 } as Anomaly;

function input(overrides: Partial<RobotActivityInput>): RobotActivityInput {
  return {
    robotConnected: true,
    investigation: null,
    target: null,
    distanceM: null,
    execution: execution("ready"),
    definition,
    ...overrides,
  };
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

describe("describeRobotActivity", () => {
  it("reports an offline robot before anything else", () => {
    const activity = describeRobotActivity(input({ robotConnected: false, investigation }));
    expect(activity.title).toBe("Robot offline");
    expect(activity.tone).toBe("offline");
  });

  it("describes the way to the anomaly with type, confidence and distance", () => {
    const activity = describeRobotActivity(input({ investigation, target, distanceM: 18.4 }));
    expect(activity).toMatchObject({ title: "Heading to anomaly", detail: "Lying down · 92% · 18 m", tone: "investigating" });
  });

  it("shows the draft verdict and the fallback while on site", () => {
    const onSite = { ...investigation, phase: "on_site" as const, draftVerdict: "unclear" as const };
    const activity = describeRobotActivity(input({ investigation: onSite, execution: execution("running") }));
    expect(activity.detail).toBe("Verdict: UNCLEAR");
    expect(activity.next).toBe("After Finish: back to the route");
  });

  it("describes the mission when not investigating", () => {
    expect(describeRobotActivity(input({ execution: execution("running", 2) }))).toMatchObject({
      title: "Patrolling",
      detail: "Loop 2/3 → WP 1",
    });
    expect(describeRobotActivity(input({ execution: execution("paused", 1) })).detail).toBe("At WP 2");
    expect(describeRobotActivity(input({ execution: execution("returning") })).title).toBe("Returning to start");
    expect(describeRobotActivity(input({ execution: null, definition: null })).detail).toBe("No mission");
  });
});
