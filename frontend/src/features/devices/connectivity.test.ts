import { describe, it, expect } from "vitest";
import { deviceConnectivity } from "./connectivity";

describe("deviceConnectivity", () => {
  it("follows the device's own flag while the backend is reachable", () => {
    expect(deviceConnectivity({ connected: true }, true)).toMatchObject({ status: "online", label: "connected" });
    expect(deviceConnectivity({ connected: false }, true)).toMatchObject({ status: "offline", label: "disconnected" });
  });

  it("is unknown, not stale green or red, while the backend is unreachable", () => {
    expect(deviceConnectivity({ connected: true }, false).status).toBe("unknown");
    expect(deviceConnectivity({ connected: false }, false).status).toBe("unknown");
  });
});
