import { describe, it, expect } from "vitest";
import { headingDegrees, remainingRoute } from "./geo";

describe("headingDegrees", () => {
  it("turns map-frame yaw (CCW from east) into a compass heading", () => {
    expect(headingDegrees(0)).toBeCloseTo(90); // east
    expect(headingDegrees(Math.PI / 2)).toBeCloseTo(0); // north
  });
});

describe("remainingRoute", () => {
  // An L: east along the equator, then north.
  const route: [number, number][] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
  ];

  it("starts at the closest point on the route and keeps what lies ahead", () => {
    const left = remainingRoute(route, [0.0005, 0.00001]);
    expect(left[0][0]).toBeCloseTo(0.0005);
    expect(left[0][1]).toBeCloseTo(0);
    expect(left.slice(1)).toEqual(route.slice(1));
  });

  it("is just the last leg once the vehicle has turned the corner", () => {
    const left = remainingRoute(route, [0.001, 0.0006]);
    expect(left).toHaveLength(2);
    expect(left[0][1]).toBeCloseTo(0.0006);
    expect(left[1]).toEqual(route[2]);
  });

  it("is the whole route before the vehicle sets off", () => {
    expect(remainingRoute(route, [0, 0])).toEqual(route);
  });
});
