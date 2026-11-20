import { describe, expect, it } from "vitest";
import { tileCount } from "./cameraTiles";

describe("tileCount", () => {
  it("splits a camera tower frame into three", () => {
    expect(tileCount(960, 240)).toBe(3);
    expect(tileCount(1920, 480)).toBe(3);
  });

  it("keeps ordinary frames whole", () => {
    expect(tileCount(848, 480)).toBe(1);
    expect(tileCount(640, 480)).toBe(1);
    expect(tileCount(1920, 1080)).toBe(1);
  });

  it("keeps a frame with no size yet whole", () => {
    expect(tileCount(0, 0)).toBe(1);
  });
});
