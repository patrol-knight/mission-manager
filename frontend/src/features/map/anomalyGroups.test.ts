import { describe, it, expect } from "vitest";
import { groupAnomalies } from "./anomalyGroups";
import type { Anomaly } from "../anomalies/anomalyTypes";

function anomaly(id: string, lon: number | null, lat = 0): Anomaly {
  return { anomalyId: id, lon, lat } as Anomaly;
}

// 1 degree of longitude = 1 px, so distances are easy to read.
const project = (lon: number, lat: number) => ({ x: lon, y: lat });

describe("groupAnomalies", () => {
  it("groups anomalies that overlap on screen and leaves distant ones single", () => {
    const { singles, groups } = groupAnomalies(
      [anomaly("a", 0), anomaly("b", 10), anomaly("c", 20), anomaly("far", 200)],
      project,
      new Set(),
    );
    expect(singles.map((a) => a.anomalyId)).toEqual(["far"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((a) => a.anomalyId)).toEqual(["a", "b", "c"]);
    expect(groups[0].lon).toBeCloseTo(10);
    expect(groups[0].key).toBe("a|b|c");
  });

  it("never groups the investigation target or the selected anomaly", () => {
    const { singles, groups } = groupAnomalies([anomaly("a", 0), anomaly("b", 5)], project, new Set(["a"]));
    expect(singles.map((a) => a.anomalyId).sort()).toEqual(["a", "b"]);
    expect(groups).toEqual([]);
  });

  it("drops anomalies without a map position", () => {
    const { singles, groups } = groupAnomalies([anomaly("a", null)], project, new Set());
    expect(singles).toEqual([]);
    expect(groups).toEqual([]);
  });
});
