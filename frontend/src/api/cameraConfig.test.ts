import { describe, it, expect, afterEach } from "vitest";
import { getCameraMode } from "./cameraConfig";

describe("getCameraMode", () => {
  afterEach(() => {
    delete window.RUNTIME_CONFIG;
  });

  it("defaults to mock when nothing is configured", () => {
    expect(getCameraMode()).toBe("mock");
  });

  it("honors a valid runtime config value", () => {
    window.RUNTIME_CONFIG = { CAMERA_MODE: "real" };
    expect(getCameraMode()).toBe("real");
  });

  it("falls back to mock on an invalid runtime config value", () => {
    window.RUNTIME_CONFIG = { CAMERA_MODE: "nonsense" };
    expect(getCameraMode()).toBe("mock");
  });
});
