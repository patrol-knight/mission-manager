import { describe, it, expect } from "vitest";
import { cameraHealthReasons, formatReasons, sortTowers, towerFov, visibleTiles } from "./towers";
import type { Device } from "../../types/domain";

const tower = (id: string, connected = true) => ({ deviceId: id, connected }) as Device;

describe("sortTowers", () => {
  it("puts alerts first (most first), then the rest by id, offline last", () => {
    const towers = [tower("c"), tower("b", false), tower("a"), tower("d"), tower("e")];
    const sorted = sortTowers(towers, { d: 1, e: 3 }).map((t) => t.deviceId);
    expect(sorted).toEqual(["e", "d", "a", "c", "b"]);
  });
});

describe("visibleTiles", () => {
  it("shows everything that fits", () => {
    expect(visibleTiles(6, 8)).toEqual({ shown: 6, hidden: 0 });
    expect(visibleTiles(8, 8)).toEqual({ shown: 8, hidden: 0 });
  });

  it("gives up the last slot to a '+N more' tile when it doesn't", () => {
    expect(visibleTiles(13, 8)).toEqual({ shown: 7, hidden: 6 });
  });
});

describe("towerFov", () => {
  const withStatus = (status: Record<string, unknown>) => ({ status }) as Device;

  it("reads the coverage the tower reports", () => {
    expect(towerFov(withStatus({ fov_deg: 90, fov_range_m: 6 }))).toEqual({ fovRad: Math.PI / 2, rangeM: 6 });
  });

  it("draws nothing when the tower doesn't report it", () => {
    expect(towerFov(withStatus({ connected: true }))).toBeNull();
    expect(towerFov(withStatus({ fov_deg: 90 }))).toBeNull();
    expect(towerFov(withStatus({ fov_deg: "90", fov_range_m: 6 }))).toBeNull();
    expect(towerFov(withStatus({ fov_deg: 0, fov_range_m: 6 }))).toBeNull();
  });
});

describe("camera health reasons", () => {
  const withHealth = (health: unknown) => ({ status: { camera_health: health } }) as unknown as Device;

  it("lists the flags that are set, in a fixed order", () => {
    const reasons = cameraHealthReasons(withHealth({ depth_degraded: true, occluded: true, overexposed: false }));
    expect(reasons).toEqual(["Occluded", "Depth degraded"]);
    expect(formatReasons(reasons)).toBe("Occluded, Depth degraded");
  });

  it("keeps three reasons on one line", () => {
    const reasons = cameraHealthReasons(withHealth({ occluded: true, overexposed: true, depth_degraded: true }));
    expect(formatReasons(reasons)).toBe("Occluded, Overexposed +1");
  });

  it("says so when there is no current data", () => {
    expect(cameraHealthReasons(withHealth(null))).toBeNull();
    expect(cameraHealthReasons(undefined)).toBeNull();
    expect(formatReasons(null)).toBe("No data");
  });
});
