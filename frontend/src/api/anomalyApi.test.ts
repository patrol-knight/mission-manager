import { describe, it, expect, vi, afterEach } from "vitest";
import * as anomalyApi from "./anomalyApi";

const rawAnomaly = {
  anomaly_id: "sim-anomaly-abc123",
  x: 1.5,
  y: 2.5,
  frame_id: "map",
  status: "robot_arrived" as const,
  detected_at: "2026-07-19T00:00:00Z",
  updated_at: "2026-07-19T00:01:00Z",
  source_device_id: "sim-robot-01",
  description: "Simulated anomaly for local development/demo.",
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
        anomalyId: "sim-anomaly-abc123",
        x: 1.5,
        y: 2.5,
        frameId: "map",
        status: "robot_arrived",
        detectedAt: "2026-07-19T00:00:00Z",
        updatedAt: "2026-07-19T00:01:00Z",
        sourceDeviceId: "sim-robot-01",
        description: "Simulated anomaly for local development/demo.",
      },
    ]);
  });

  it("verifyAnomaly POSTs to the verify endpoint and returns the updated anomaly", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ...rawAnomaly, status: "verified" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await anomalyApi.verifyAnomaly("sim-anomaly-abc123");
    expect(result.status).toBe("verified");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/anomalies/sim-anomaly-abc123/verify");
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
