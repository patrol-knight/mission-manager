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

  it("adapts getMapInfo's snake_case response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          map_name: "demo",
          frame_id: "map",
          origin_lat: 37.38,
          origin_lon: -122.03,
          lanelet_count: 12,
        }),
      ),
    );
    const info = await mapApi.getMapInfo();
    expect(info).toEqual({
      mapName: "demo",
      frameId: "map",
      originLat: 37.38,
      originLon: -122.03,
      laneletCount: 12,
    });
  });

  it("unwraps is-in-lanelet's boolean field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ in_lanelet: true })));
    await expect(mapApi.isInLanelet(1, 2)).resolves.toBe(true);
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

  it("adapts lngLatToXy's response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ x: 5, y: 6, frame_id: "map" })),
    );
    await expect(mapApi.lngLatToXy(37.1, -122.1)).resolves.toEqual({
      x: 5,
      y: 6,
      frameId: "map",
    });
  });
});
