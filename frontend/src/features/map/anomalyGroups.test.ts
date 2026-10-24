import { describe, it, expect } from "vitest";
import { groupAnomalies, hideUnderTarget } from "./anomalyGroups";
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

  it("merges a cluster with a neighbour its bigger marker would overlap", () => {
    // a+b cluster (24 px wide) at 5; c at 26 is 21 px from it: two singles
    // that far apart wouldn't touch (20 px), but the cluster would.
    const { singles, groups } = groupAnomalies([anomaly("a", 0), anomaly("b", 10), anomaly("c", 26)], project, new Set());
    expect(singles).toEqual([]);
    expect(groups.map((g) => g.key)).toEqual(["a|b|c"]);
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

describe("hideUnderTarget", () => {
  it("hides markers the investigated one covers, keeping far and selected ones", () => {
    const target = anomaly("t", 0);
    const near = anomaly("near", 10);
    const picked = anomaly("picked", 5);
    const far = anomaly("far", 200);
    const group = { key: "g1|g2", members: [anomaly("g1", 15), anomaly("g2", 17)], lon: 16, lat: 0 };
    const { singles, groups, hidden } = hideUnderTarget([target, near, picked, far], [group], target, project, new Set(["picked"]));
    expect(singles.map((a) => a.anomalyId)).toEqual(["t", "picked", "far"]);
    expect(groups).toEqual([]);
    expect(hidden.map((a) => a.anomalyId)).toEqual(["near", "g1", "g2"]);
  });

  it("hides nothing without an investigation", () => {
    const { singles, hidden } = hideUnderTarget([anomaly("a", 0)], [], null, project, new Set());
    expect(singles).toHaveLength(1);
    expect(hidden).toEqual([]);
  });
});
