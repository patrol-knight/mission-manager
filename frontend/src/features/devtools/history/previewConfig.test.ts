import { describe, expect, it } from "vitest";
import { formatAgo, formatDuration } from "./historyFormat";
import { defaultState, envLines, heatmapQuery } from "./previewConfig";

const SERVER = {
  sources: ["sim" as const],
  bandwidth_m: 4,
  half_life_days: 21,
  prior_hours: 2,
  floor_per_hour: 0.05,
  ceiling_per_hour: 5,
};

describe("preview config", () => {
  it("starts from the backend's settings", () => {
    expect(defaultState(SERVER)).toMatchObject({ source: "sim", demand_bandwidth_m: 4, floor_per_hour: 0.05 });
    expect(defaultState({ ...SERVER, sources: ["sim", "real"] }).source).toBe("all");
  });

  it("sends only the active model's parameters", () => {
    const state = defaultState(SERVER);
    expect(heatmapQuery(state)).not.toHaveProperty("w_unclear");
    const density = heatmapQuery({ ...state, model: "density" });
    expect(density).toMatchObject({ bandwidth_m: 7.5, w_unclear: 0.7 });
    expect(density).not.toHaveProperty("prior_hours");
  });

  it("copies .env lines the backend reads", () => {
    const lines = envLines({ ...defaultState(SERVER), source: "all", ceiling_per_hour: 8 });
    expect(lines.split("\n")).toEqual([
      "HEATMAP_SOURCES=sim,real",
      "HEATMAP_BANDWIDTH_M=4",
      "HEATMAP_HALF_LIFE_DAYS=21",
      "HEATMAP_PRIOR_HOURS=2",
      "HEATMAP_SCALE_FLOOR=0.05",
      "HEATMAP_SCALE_CEILING=8",
    ]);
  });
});

describe("history formatting", () => {
  it("formats durations and ages", () => {
    expect(formatDuration("2026-01-01T09:00:00Z", "2026-01-01T09:45:00Z")).toBe("45 min");
    expect(formatDuration("2026-01-01T09:00:00Z", "2026-01-01T12:05:00Z")).toBe("3 h 05 min");
    expect(formatDuration("2026-01-01T09:00:00Z", null)).toBe("");
    const now = Date.parse("2026-01-10T00:00:00Z");
    expect(formatAgo("2026-01-09T23:30:00Z", now)).toBe("30 min ago");
    expect(formatAgo("2026-01-05T00:00:00Z", now)).toBe("5 days ago");
  });
});
