import { describe, it, expect } from "vitest";
import { dwellLeft, type MissionExecutionState } from "./missionTypes";
import { formatCountdown, formatDwell } from "./missionSummaryFormat";

const holding: MissionExecutionState = {
  missionId: "m",
  status: "running",
  currentLoop: 1,
  completedLoops: 0,
  currentWaypointIndex: 1,
  targetWaypointIndex: 2,
  joining: false,
  dwellSec: 30,
  dwellRemainingSec: 20,
  receivedAt: 1_000_000,
  updatedAt: null,
};

describe("dwell", () => {
  it("counts down from when the state arrived, and stops at zero", () => {
    expect(dwellLeft(holding, 1_000_000)).toBe(20);
    expect(dwellLeft(holding, 1_005_000)).toBe(15);
    expect(dwellLeft(holding, 1_100_000)).toBe(0);
  });

  it("stays frozen while paused, and is null when not dwelling", () => {
    expect(dwellLeft({ ...holding, status: "paused" }, 1_005_000)).toBe(20);
    expect(dwellLeft({ ...holding, dwellSec: null, dwellRemainingSec: null }, 1_000_000)).toBeNull();
    expect(dwellLeft(null, 0)).toBeNull();
  });

  it("formats dwells and countdowns", () => {
    expect(formatDwell(30)).toBe("30 s");
    expect(formatDwell(60)).toBe("1 min");
    expect(formatDwell(90)).toBe("1 min 30 s");
    expect(formatCountdown(18.2)).toBe("0:19");
    expect(formatCountdown(65)).toBe("1:05");
  });
});
