import { describe, it, expect, vi, afterEach } from "vitest";
import * as deviceApi from "./deviceApi";

const rawRobot = {
  device_id: "sim-robot-01",
  name: "Robot 1",
  type: "robot" as const,
  pose: { frame_id: "map", x: 1, y: 2, yaw: 0.5 },
  timestamp: 1000,
  battery: 87,
  speed: 0.4,
  status: {},
  capabilities: ["camera"],
  connected: true,
  last_seen: 1001,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("deviceApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists devices adapted to camelCase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([rawRobot])));
    const devices = await deviceApi.listDevices();
    expect(devices).toEqual([
      {
        deviceId: "sim-robot-01",
        name: "Robot 1",
        type: "robot",
        pose: { frameId: "map", x: 1, y: 2, yaw: 0.5 },
        timestamp: 1000,
        battery: 87,
        speed: 0.4,
        status: {},
        capabilities: ["camera"],
        connected: true,
        lastSeen: 1001,
      },
    ]);
  });

  it("URL-encodes the device id on getDevice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rawRobot));
    vi.stubGlobal("fetch", fetchMock);
    await deviceApi.getDevice("weird id/here");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain(encodeURIComponent("weird id/here"));
  });
});
