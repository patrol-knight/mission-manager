import type { Device } from "../../types/domain";

/** Towers in the order an operator needs them: open alerts first (most
 * first), then the ones that are offline, then the rest -- each group by
 * name. */
export function sortTowers(towers: Device[], alertCounts: Record<string, number>): Device[] {
  const rank = (t: Device) => ((alertCounts[t.deviceId] ?? 0) > 0 ? 0 : t.connected ? 2 : 1);
  return [...towers].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (alertCounts[b.deviceId] ?? 0) - (alertCounts[a.deviceId] ?? 0) ||
      (a.name ?? a.deviceId).localeCompare(b.name ?? b.deviceId),
  );
}

/** How many tiles to draw in `capacity` slots: everything if it fits,
 * otherwise one slot less, the last one becoming "+N more". */
export function visibleTiles(total: number, capacity: number): { shown: number; hidden: number } {
  if (total <= capacity) return { shown: total, hidden: 0 };
  const shown = Math.max(0, capacity - 1);
  return { shown, hidden: total - shown };
}
