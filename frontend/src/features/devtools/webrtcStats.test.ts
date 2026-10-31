import { afterEach, describe, expect, it, vi } from "vitest";
import { WebrtcStatsSampler } from "./webrtcStats";
import { percentile, summarizePings } from "./metrics";

function report(stats: Record<string, unknown>[]): RTCStatsReport {
  return new Map(stats.map((s) => [s.id as string, s])) as unknown as RTCStatsReport;
}

function snapshot(bytes: number, received: number, lost: number) {
  return report([
    {
      id: "in", type: "inbound-rtp", kind: "video", bytesReceived: bytes, packetsReceived: received,
      packetsLost: lost, jitter: 0.004, framesPerSecond: 30, framesDecoded: 90,
      jitterBufferDelay: received * 0.05, jitterBufferEmittedCount: received,
    },
    { id: "tr", type: "transport", selectedCandidatePairId: "cp" },
    { id: "cp", type: "candidate-pair", currentRoundTripTime: 0.012, localCandidateId: "l", remoteCandidateId: "r" },
    { id: "l", type: "local-candidate", candidateType: "host", address: "192.168.1.10", port: 50000 },
    { id: "r", type: "remote-candidate", candidateType: "host", address: "192.168.1.159", port: 50001 },
  ]);
}

describe("WebrtcStatsSampler", () => {
  afterEach(() => vi.restoreAllMocks());

  it("turns cumulative counters into per-second rates", () => {
    const now = vi.spyOn(performance, "now");
    const sampler = new WebrtcStatsSampler("iot-01");

    now.mockReturnValue(1000);
    const first = sampler.sample(snapshot(0, 0, 0), "connected");
    expect(first.bitrate_kbps).toBeNull();
    expect(first.rtt_ms).toBe(12);
    expect(first.remote_candidate).toBe("host 192.168.1.159:50001");

    now.mockReturnValue(2000);
    const second = sampler.sample(snapshot(250_000, 99, 1), "connected");
    expect(second.bitrate_kbps).toBe(2000);
    expect(second.loss_pct).toBe(1);
    expect(second.jitter_ms).toBe(4);
    expect(second.jitter_buffer_ms).toBeCloseTo(50);
  });
});

describe("metrics", () => {
  it("summarizes pings over the last minute", () => {
    const pings = [10, 20, null, 40].map((rtt, i) => ({
      t: 100 + i, device_id: "d", ip: "x", rtt_ms: rtt, lost: rtt === null,
    }));
    const summary = summarizePings(pings);
    expect(summary.lossPct).toBe(25);
    expect(summary.last).toBe(40);
    expect(summary.p50).toBe(20);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});
