import { describe, it, expect, vi, afterEach } from "vitest";
import * as missionApi from "./missionApi";
import type { Waypoint } from "../features/missions/missionTypes";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const waypoints: Waypoint[] = [
  { waypointId: "wp1", x: 0, y: 0, yaw: null, label: null, type: "patrol" },
  { waypointId: "wp2", x: 1, y: 1, yaw: null, label: null, type: "patrol" },
];

const rawMission = {
  mission_id: "patrol-a-x1y2z3",
  name: "Patrol A",
  map_name: "demo",
  frame_id: "map",
  description: null,
  time_slot: null,
  waypoints: [
    { waypoint_id: "wp1", x: 0, y: 0, yaw: null, label: null, type: "patrol" },
    { waypoint_id: "wp2", x: 1, y: 1, yaw: null, label: null, type: "patrol" },
  ],
  loop_count: 2,
  created_at: null,
  updated_at: null,
  metadata: {},
};

describe("missionApi.saveMission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs a new mission and activates it when missionId is null", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ map_name: "demo", frame_id: "map", origin_lat: 0, origin_lon: 0, lanelet_count: 1 })) // getMapInfo
      .mockResolvedValueOnce(jsonResponse(rawMission)) // POST create
      .mockResolvedValueOnce(jsonResponse(rawMission)); // POST activate
    vi.stubGlobal("fetch", fetchMock);

    const result = await missionApi.saveMission({
      missionId: null,
      name: "Patrol A",
      loopCount: 2,
      waypoints,
    });

    expect(result.name).toBe("Patrol A");
    expect(result.loopCount).toBe(2);

    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toContain("/api/missions");
    expect(createInit.method).toBe("POST");
    const createBody = JSON.parse(createInit.body);
    expect(createBody.map_name).toBe("demo");
    expect(createBody.loop_count).toBe(2);
    expect(createBody.mission_id).toMatch(/^patrol-a-[a-z0-9]+$/);

    const [activateUrl] = fetchMock.mock.calls[2];
    expect(activateUrl).toContain(`/api/missions/${createBody.mission_id}/activate`);
  });

  it("PUTs an existing mission by its missionId and activates it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ map_name: "demo", frame_id: "map", origin_lat: 0, origin_lon: 0, lanelet_count: 1 }))
      .mockResolvedValueOnce(jsonResponse(rawMission))
      .mockResolvedValueOnce(jsonResponse(rawMission));
    vi.stubGlobal("fetch", fetchMock);

    await missionApi.saveMission({
      missionId: "patrol-a-x1y2z3",
      name: "Patrol A",
      loopCount: 2,
      waypoints,
    });

    const [updateUrl, updateInit] = fetchMock.mock.calls[1];
    expect(updateUrl).toContain("/api/missions/patrol-a-x1y2z3");
    expect(updateInit.method).toBe("PUT");
    expect(JSON.parse(updateInit.body).mission_id).toBe("patrol-a-x1y2z3");
  });

  it("falls back to a default map name if getMapInfo fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(rawMission))
      .mockResolvedValueOnce(jsonResponse(rawMission));
    vi.stubGlobal("fetch", fetchMock);

    await missionApi.saveMission({ missionId: null, name: "Patrol A", loopCount: 1, waypoints });

    const [, createInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(createInit.body).map_name).toBe("default");
  });
});

const rawExecution = {
  mission_id: "patrol-a-x1y2z3",
  status: "running" as const,
  current_loop: 1,
  completed_loops: 0,
  current_waypoint_index: 0,
  updated_at: "2026-07-19T00:00:00Z",
};

describe("missionApi execution controls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getExecutionState returns null on 404 (no current mission)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "none" }), { status: 404 })));
    await expect(missionApi.getExecutionState()).resolves.toBeNull();
  });

  it("getExecutionState adapts the raw response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(rawExecution)));
    await expect(missionApi.getExecutionState()).resolves.toEqual({
      missionId: "patrol-a-x1y2z3",
      status: "running",
      currentLoop: 1,
      completedLoops: 0,
      currentWaypointIndex: 0,
      updatedAt: "2026-07-19T00:00:00Z",
    });
  });

  it.each([
    ["startMission", "/api/missions/current/start"],
    ["pauseMission", "/api/missions/current/pause"],
    ["resumeMission", "/api/missions/current/resume"],
    ["stopMission", "/api/missions/current/stop"],
  ] as const)("%s POSTs to %s", async (fnName, path) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rawExecution));
    vi.stubGlobal("fetch", fetchMock);
    await missionApi[fnName]();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(path);
    expect(init.method).toBe("POST");
  });
});

const rawSummary = {
  mission_id: "patrol-a-x1y2z3",
  name: "Patrol A",
  map_name: "demo",
  frame_id: "map",
  waypoint_count: 2,
  time_slot: null,
  is_current: true,
  is_default: false,
  updated_at: "2026-07-19T00:00:00Z",
};

describe("missionApi mission picker calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listMissionSummaries adapts the raw list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([rawSummary])));
    const summaries = await missionApi.listMissionSummaries();
    expect(summaries).toEqual([
      {
        missionId: "patrol-a-x1y2z3",
        name: "Patrol A",
        mapName: "demo",
        frameId: "map",
        waypointCount: 2,
        timeSlot: null,
        isCurrent: true,
        isDefault: false,
        updatedAt: "2026-07-19T00:00:00Z",
      },
    ]);
  });

  it("getMission GETs the mission by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rawMission));
    vi.stubGlobal("fetch", fetchMock);
    const mission = await missionApi.getMission("patrol-a-x1y2z3");
    expect(mission.name).toBe("Patrol A");
    expect(fetchMock.mock.calls[0][0]).toContain("/api/missions/patrol-a-x1y2z3");
  });

  it("deleteMission DELETEs the mission by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await missionApi.deleteMission("patrol-a-x1y2z3");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/missions/patrol-a-x1y2z3");
    expect(init.method).toBe("DELETE");
  });

  it("deleteMission propagates a 409 (edit-locked) as an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "locked" }), { status: 409 })),
    );
    await expect(missionApi.deleteMission("x")).rejects.toMatchObject({ status: 409 });
  });
});

describe("missionApi.validateRoute", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns valid:true with the route when the backend confirms one", async () => {
    const route = { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: true, route })));
    const result = await missionApi.validateRoute(waypoints);
    expect(result.valid).toBe(true);
    expect(result.route).toEqual(route);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid:false when the backend reports no route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false, route: null })));
    const result = await missionApi.validateRoute(waypoints);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("route_unreachable");
  });

  it("returns valid:false (not a throw) when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    const result = await missionApi.validateRoute(waypoints);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("validation_failed");
  });

  it("closes the loop by appending the first waypoint again", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, route: null }));
    vi.stubGlobal("fetch", fetchMock);
    await missionApi.validateRoute(waypoints);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.waypoints).toHaveLength(waypoints.length + 1);
    expect(body.waypoints.at(-1)).toEqual(body.waypoints[0]);
  });
});
