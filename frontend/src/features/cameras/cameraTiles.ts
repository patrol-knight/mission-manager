/** Camera tower frames arrive as three 4:3 images side by side (4:1). */
export const TOWER_TILES = 3;
const TILE_ASPECT = 4 / 3;
const TOLERANCE = 0.1;

/** How many side-by-side tiles a frame of this size holds: 3 for a camera
 * tower frame, otherwise 1. */
export function tileCount(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  const expected = TOWER_TILES * TILE_ASPECT;
  return Math.abs(width / height - expected) / expected <= TOLERANCE ? TOWER_TILES : 1;
}
