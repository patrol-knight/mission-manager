import { describe, expect, it } from "vitest";
import { bestClock, offsetLevel } from "./metrics";

const sample = (t: number, offset_ms: number, rtt_ms: number) => ({ t, device_id: "iot-01", offset_ms, rtt_ms });

describe("bestClock", () => {
  it("picks the shortest round trip in the last minute", () => {
    const samples = [sample(0, 90, 2), sample(70, 12, 30), sample(80, 10, 8), sample(90, 11, 20)];
    expect(bestClock(samples)?.offset_ms).toBe(10);
    expect(bestClock([])).toBeNull();
  });

  it("grades the offset", () => {
    expect(offsetLevel(-3)).toBe("ok");
    expect(offsetLevel(20)).toBe("warn");
    expect(offsetLevel(-120)).toBe("bad");
    expect(offsetLevel(null)).toBe("idle");
  });
});
