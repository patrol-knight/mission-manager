/** Transparent below the floor, then amber -> orange -> orange-red. Kept away
 * from the editor's mauve so the heatmap never reads as part of the mission. */
const STOPS: [number, [number, number, number, number]][] = [
  [0, [251, 191, 36, 0]],
  [0.08, [251, 191, 36, 0]],
  [0.3, [251, 191, 36, 0.55]],
  [0.65, [249, 115, 22, 0.8]],
  [1, [226, 65, 43, 0.95]],
];

export const HEATMAP_LUT: Uint8ClampedArray<ArrayBuffer> = (() => {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const k = STOPS.findIndex(([s]) => s >= t);
    const [t1, c1] = STOPS[Math.max(1, k)];
    const [t0, c0] = STOPS[Math.max(0, k - 1)];
    const f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
    for (let j = 0; j < 4; j++) {
      const v = c0[j] + (c1[j] - c0[j]) * f;
      lut[i * 4 + j] = j === 3 ? v * 255 : v;
    }
  }
  return lut;
})();

/** RGBA pixels for a base64 grid of uint8 intensities. */
export function colorizeHeatmap(base64: string): Uint8ClampedArray<ArrayBuffer> {
  const values = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const pixels = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => pixels.set(HEATMAP_LUT.subarray(v * 4, v * 4 + 4), i * 4));
  return pixels;
}
