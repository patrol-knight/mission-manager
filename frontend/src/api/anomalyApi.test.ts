import { describe, it, expect, vi, afterEach } from "vitest";
import * as anomalyApi from "./anomalyApi";

const rawAnomaly = {
  anomaly_id: "6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
  types: ["lying_down", "loitering"],
  x: 1.5,
  y: 2.5,
  frame_id: "map",
  confidence: 0.92,
  source_device_id: "iot-01",
  status: "robot_arrived" as const,
  detected_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:01:00Z",
  last_seen_at: "2026-07-19T00:01:00Z",
  degrade_sec: 30,
  expires_at: "2026-07-19T00:01:30Z",
  lat: 25.0,
  lon: 121.5,
  resolution: null,
  resolved_at: null,
  mission_id: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("anomalyApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists anomalies adapted to camelCase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([rawAnomaly])));
    const anomalies = await anomalyApi.listAnomalies();
    expect(anomalies).toEqual([
      {
        anomalyId: "6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
        types: ["lying_down", "loitering"],
        x: 1.5,
        y: 2.5,
        frameId: "map",
        confidence: 0.92,
        sourceDeviceId: "iot-01",
        status: "robot_arrived",
        detectedAt: "2026-07-19T00:00:00Z",
        updatedAt: "2026-07-19T00:01:00Z",
        lastSeenAt: "2026-07-19T00:01:00Z",
        degradeSec: 30,
        expiresAt: "2026-07-19T00:01:30Z",
        lat: 25.0,
        lon: 121.5,
        resolution: null,
        resolvedAt: null,
        missionId: null,
      },
    ]);
  });

  it("verifyAnomaly POSTs to the verify endpoint and returns the updated anomaly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...rawAnomaly, status: "verified" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await anomalyApi.verifyAnomaly("6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b");
    expect(result.status).toBe("verified");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/anomalies/6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b/verify");
    expect(init.method).toBe("POST");
  });

  it("propagates a 409 as an ApiError when the anomaly isn't robot_arrived", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Cannot verify" }), { status: 409 })),
    );
    await expect(anomalyApi.verifyAnomaly("x")).rejects.toMatchObject({ status: 409 });
  });
});
