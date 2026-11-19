import { describe, expect, it } from "vitest";
import { HEATMAP_LUT, colorizeHeatmap } from "./heatmapColormap";

const alpha = (v: number) => HEATMAP_LUT[v * 4 + 3];

describe("heatmap colormap", () => {
  it("keeps low density fully transparent", () => {
    expect(alpha(0)).toBe(0);
    expect(alpha(15)).toBe(0);
  });

  it("grows more opaque and redder towards the peak", () => {
    expect(alpha(128)).toBeGreaterThan(alpha(60));
    expect(alpha(255)).toBeGreaterThan(alpha(128));
    expect(HEATMAP_LUT[255 * 4 + 1]).toBeLessThan(HEATMAP_LUT[60 * 4 + 1]);
  });

  it("colorizes one RGBA pixel per value", () => {
    const pixels = colorizeHeatmap(btoa(String.fromCharCode(0, 255)));
    expect(pixels.length).toBe(8);
    expect(pixels[3]).toBe(0);
    expect(pixels[7]).toBe(alpha(255));
  });
});
