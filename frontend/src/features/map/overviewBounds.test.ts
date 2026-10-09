import { describe, it, expect } from "vitest";
import { overviewBounds, type LngLatBoundsLike } from "./overviewBounds";
import type { Device } from "../../types/domain";

const map: LngLatBoundsLike = [
  [0, 0],
  [10, 10],
];
const device = (lon: number, lat: number, connected = true) => ({ connected, pose: { lon, lat } }) as unknown as Device;
const ONE_DEG_M = 111_320;

describe("overviewBounds", () => {
  it("is the whole map when every device (plus margin) is inside it", () => {
    expect(overviewBounds(map, [device(5, 5)])).toEqual(map);
  });

  it("grows to include a tower at the map's edge plus its margin, connected or not", () => {
    const [[west, south], [east, north]] = overviewBounds(map, [device(12, 0, false)], ONE_DEG_M)!;
    expect(west).toBe(0);
    expect(south).toBeCloseTo(-1); // 1 degree of latitude below the tower
    expect(east).toBeCloseTo(13); // at the equator, 1 degree of longitude too
    expect(north).toBe(10);
  });

  it("works without map bounds, and is null with nothing at all", () => {
    expect(overviewBounds(null, [device(1, 2)], 0)).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(overviewBounds(null, [])).toBeNull();
  });
});
