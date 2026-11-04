import { describe, it, expect } from "vitest";
import { robotMode, robotStatus, robotUnavailableHint } from "./robotStatus";
import type { Device } from "../../types/domain";
import { missionProgress, missionStatus, targetWaypointIndex } from "../missions/missionStatus";
import type { MissionExecutionState, MissionStatus } from "../missions/missionTypes";
import type { Investigation } from "../investigation/investigationTypes";

function execution(status: MissionStatus, targetWaypointIndex: number | null = 2, joining = false): MissionExecutionState {
  return {
    missionId: "m1",
    status,
    currentLoop: 2,
    completedLoops: 1,
    currentWaypointIndex: 0,
    targetWaypointIndex,
    joining,
    updatedAt: null,
  };
}

const investigation = { anomalyId: "a1", phase: "en_route" } as Investigation;

describe("robotStatus", () => {
  it("reports an offline robot before anything else", () => {
    expect(robotStatus(false, investigation, execution("running"), "navigating").label).toBe("Offline");
  });

  it("shows the investigation phase over the mission", () => {
    expect(robotStatus(true, investigation, execution("running"), "navigating").label).toBe("En route");
    expect(robotStatus(true, { ...investigation, phase: "on_site" }, null, "arrived").label).toBe("On site");
  });

  it("shows the robot's own trouble over the investigation and mission", () => {
    expect(robotStatus(true, investigation, execution("running"), "failure").label).toBe("Failure");
    expect(robotStatus(true, null, null, "notready").label).toBe("Not ready");
  });

  it("is patrolling while the robot drives, mission or not", () => {
    expect(robotStatus(true, null, null, "navigating").label).toBe("Patrolling");
    expect(robotStatus(true, null, execution("running"), "arrived").label).toBe("Patrolling");
    expect(robotStatus(true, null, execution("ready"), "arrived").label).toBe("Ready");
  });

  it("follows the mission otherwise", () => {
    expect(robotStatus(true, null, execution("running"), "idle").label).toBe("Patrolling");
    expect(robotStatus(true, null, execution("paused"), "idle").label).toBe("Holding");
    expect(robotStatus(true, null, execution("ready"), "idle").label).toBe("Ready");
    expect(robotStatus(true, null, null, "idle").label).toBe("Ready");
  });

  it("leaves manual to the mode pill", () => {
    expect(robotStatus(true, null, execution("paused"), "manual").label).toBe("Not ready");
  });

  it("is not ready when the robot reports no state or an unknown one", () => {
    expect(robotStatus(true, null, null, null).label).toBe("Not ready");
    expect(robotStatus(true, null, execution("running"), "").label).toBe("Not ready");
    expect(robotStatus(true, investigation, null, "charging").label).toBe("Not ready");
  });
});

describe("robotUnavailableHint", () => {
  const robot = (state?: string) =>
    ({ deviceId: "r", status: state ? { operational_state: state } : {} }) as unknown as Device;

  it("explains why the robot can't take a mission", () => {
    expect(robotUnavailableHint(null)).toBe("The robot is offline");
    expect(robotUnavailableHint(robot("failure"))).toBe("Please adjust the robot");
    expect(robotUnavailableHint(robot("manual"))).toBe("The robot is in manual mode");
    expect(robotUnavailableHint(robot("notready"))).toBe("The robot is not ready");
  });

  it("is null when the robot can drive", () => {
    expect(robotUnavailableHint(robot("idle"))).toBeNull();
    expect(robotUnavailableHint(robot("arrived"))).toBeNull();
    expect(robotUnavailableHint(robot("navigating"))).toBeNull();
  });

  it("is manual when state_machine says so, even if Autoware is ready", () => {
    const manual = { deviceId: "r", status: { operational_state: "idle", mode: "manual" } } as unknown as Device;
    expect(robotUnavailableHint(manual)).toBe("The robot is in manual mode");
  });

  it("is not ready without a known state", () => {
    expect(robotUnavailableHint(robot())).toBe("The robot is not ready");
    expect(robotUnavailableHint(robot("charging"))).toBe("The robot is not ready");
  });
});

describe("missionStatus", () => {
  it("is suspended during an investigation whatever the execution says", () => {
    expect(missionStatus(execution("running"), true).label).toBe("Suspended");
  });

  it("names each execution status", () => {
    expect(missionStatus(execution("running"), false).label).toBe("Running");
    expect(missionStatus(execution("paused"), false).label).toBe("Paused");
    expect(missionStatus(execution("not_ready"), false).label).toBe("Not ready");
    expect(missionStatus(null, false).label).toBe("Ready");
  });
});

describe("targetWaypointIndex", () => {
  it("is the backend's target while running or paused, and nothing while idle", () => {
    expect(targetWaypointIndex(execution("running", 1), 3)).toBe(1);
    expect(targetWaypointIndex(execution("paused", 0), 3)).toBe(0);
    expect(targetWaypointIndex(execution("ready", null), 3)).toBeNull();
  });
});

describe("missionProgress", () => {
  const finite = { loopCount: 2, infiniteLoop: false };
  const infinite = { loopCount: 1, infiniteLoop: true };

  it("starts empty while ready", () => {
    const { waypoints, loops } = missionProgress(3, finite, { ...execution("ready", null), completedLoops: 0 });
    expect(waypoints).toMatchObject({ done: 0, fraction: "0/3" });
    expect(loops).toMatchObject({ done: 0, fraction: "0/2" });
  });

  it("fills a leg only once its end is reached", () => {
    // Heading to waypoint 2: nothing done yet.
    expect(missionProgress(3, finite, execution("running", 1)).waypoints).toMatchObject({ done: 0, fraction: "0/3" });
    // Heading to 3: the first leg is done.
    expect(missionProgress(3, finite, execution("running", 2)).waypoints).toMatchObject({ done: 1, fraction: "1/3" });
    // Closing the loop back to 1: all but the last leg.
    expect(missionProgress(3, finite, execution("running", 0)).waypoints).toMatchObject({ done: 2, fraction: "2/3" });
  });

  it("counts the legs before the joining waypoint as done", () => {
    expect(missionProgress(3, finite, execution("running", 2, true)).waypoints).toMatchObject({ done: 1 });
    expect(missionProgress(3, finite, execution("running", 0, true)).waypoints).toMatchObject({ done: 0 });
  });

  it("fills a loop only once it is finished", () => {
    const { loops } = missionProgress(3, finite, { ...execution("running"), currentLoop: 2, completedLoops: 1 });
    expect(loops).toMatchObject({ done: 1, fraction: "1/2" });
  });

  it("shows just the loop number for an infinite mission", () => {
    expect(missionProgress(3, infinite, execution("running")).loops).toMatchObject({ total: null, fraction: "2" });
    expect(missionProgress(3, infinite, execution("ready", null)).loops.fraction).toBe("1");
  });
});

describe("robotMode", () => {
  const robot = (status: Record<string, string>) => ({ deviceId: "r", status }) as unknown as Device;

  it("is Auto while autonomy drives", () => {
    expect(robotMode(robot({ mode: "auto" }))?.label).toBe("Auto");
  });

  it("is Manual from state_machine or from Autoware", () => {
    expect(robotMode(robot({ mode: "manual" }))?.label).toBe("Manual");
    expect(robotMode(robot({ operational_state: "manual" }))?.label).toBe("Manual");
  });

  it("shows no pill while nobody drives or no mode is reported", () => {
    expect(robotMode(robot({ mode: "none" }))).toBeNull();
    expect(robotMode(robot({}))).toBeNull();
    expect(robotMode(null)).toBeNull();
  });
});
