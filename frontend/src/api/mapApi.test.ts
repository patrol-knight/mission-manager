import { describe, it, expect, vi, afterEach } from "vitest";
import * as mapApi from "./mapApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("mapApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("places a waypoint in one request, or returns null off the road", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ x: 5, y: 6, frame_id: "map", lanelet_id: 9, lat: 37.1, lon: -122.1 }))
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mapApi.placeWaypoint(37.1, -122.1)).resolves.toEqual({ x: 5, y: 6, lat: 37.1, lon: -122.1 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ lat: 37.1, lon: -122.1, frame_id: "map" });
    await expect(mapApi.placeWaypoint(0, 0)).resolves.toBeNull();
  });

  it("sends waypoints with default frame_id on routePreview", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ok: true, route: null }));
    vi.stubGlobal("fetch", fetchMock);
    await mapApi.routePreview([{ x: 1, y: 2 }, { x: 3, y: 4, yaw: 1.5 }]);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      waypoints: [
        { x: 1, y: 2, yaw: null, frame_id: "map" },
        { x: 3, y: 4, yaw: 1.5, frame_id: "map" },
      ],
    });
  });
});
