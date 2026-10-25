import { describe, it, expect } from "vitest";
import { formatDistance, formatDuration, estimateEtaSeconds } from "./missionSummaryFormat";

describe("formatDistance", () => {
  it("returns an em dash for null", () => {
    expect(formatDistance(null)).toBe("—");
  });

  it("formats sub-kilometer distances in meters", () => {
    expect(formatDistance(142)).toBe("142 m");
  });

  it("formats distances >= 1000m in kilometers", () => {
    expect(formatDistance(1234)).toBe("1.2 km");
  });
});

describe("estimateEtaSeconds", () => {
  it("returns null when distance is null", () => {
    expect(estimateEtaSeconds(null, 1)).toBeNull();
  });

  it("scales by loop count and divides by speed", () => {
    expect(estimateEtaSeconds(100, 2, 1)).toBe(200);
  });

  it("returns null for a non-positive speed", () => {
    expect(estimateEtaSeconds(100, 1, 0)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("returns an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("shows <1 min for sub-minute durations", () => {
    expect(formatDuration(20)).toBe("<1 min");
  });

  it("formats minutes under an hour", () => {
    expect(formatDuration(125)).toBe("2 min");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3900)).toBe("1h 5m");
  });

  it("omits minutes when exactly on the hour", () => {
    expect(formatDuration(7200)).toBe("2h");
  });
});
