import type { Device } from "../../types/domain";

/** A tower whose camera is up: one that is connected. Only these get a
 * field of view on the map; a disconnected tower stays in the list and on
 * the map, marked offline. */
export function isLiveTower(device: Device): boolean {
  return device.type === "iot" && device.connected;
}

/** Towers in the order an operator needs them: connected ones first --
 * those with open alerts on top (most first) -- then the offline ones, each
 * group by device id. */
export function sortTowers(towers: Device[], alertCounts: Record<string, number>): Device[] {
  const rank = (t: Device) => (!t.connected ? 2 : (alertCounts[t.deviceId] ?? 0) > 0 ? 0 : 1);
  return [...towers].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (alertCounts[b.deviceId] ?? 0) - (alertCounts[a.deviceId] ?? 0) ||
      a.deviceId.localeCompare(b.deviceId),
  );
}

/** How many tiles to draw in `capacity` slots: everything if it fits,
 * otherwise one slot less, the last one becoming "+N more". */
export function visibleTiles(total: number, capacity: number): { shown: number; hidden: number } {
  if (total <= capacity) return { shown: total, hidden: 0 };
  const shown = Math.max(0, capacity - 1);
  return { shown, hidden: total - shown };
}

/** A tower's camera coverage, as its status reports it (`fov_deg`, the
 * horizontal field of view, and `fov_range_m`) -- null when either is
 * missing or not a positive number, so nothing is drawn rather than a guess. */
export function towerFov(device: Device): { fovRad: number; rangeM: number } | null {
  const { fov_deg: fovDeg, fov_range_m: rangeM } = device.status;
  if (typeof fovDeg !== "number" || typeof rangeM !== "number") return null;
  if (!(fovDeg > 0 && rangeM > 0)) return null;
  return { fovRad: (Math.min(fovDeg, 360) * Math.PI) / 180, rangeM };
}

/** Live towers whose field of view covers map point (x, y), nearest first. */
export function towersSeeing(devices: Device[], x: number, y: number): Device[] {
  return devices
    .filter((d) => {
      const fov = isLiveTower(d) ? towerFov(d) : null;
      if (!fov || !d.pose) return false;
      const dx = x - d.pose.x;
      const dy = y - d.pose.y;
      if (Math.hypot(dx, dy) > fov.rangeM) return false;
      const off = Math.atan2(Math.sin(Math.atan2(dy, dx) - d.pose.yaw), Math.cos(Math.atan2(dy, dx) - d.pose.yaw));
      return Math.abs(off) <= fov.fovRad / 2;
    })
    .sort((a, b) => Math.hypot(x - a.pose!.x, y - a.pose!.y) - Math.hypot(x - b.pose!.x, y - b.pose!.y));
}

const CAMERA_FLAGS = [
  ["occluded", "Occluded"],
  ["overexposed", "Overexposed"],
  ["depth_degraded", "Depth degraded"],
] as const;

/** Why a tower's camera is unhealthy, from its `status.camera_health`, in a
 * fixed order; null when the tower sends no current health data. */
export function cameraHealthReasons(device: Device | undefined): string[] | null {
  const health = device?.status.camera_health;
  if (!health || typeof health !== "object") return null;
  const flags = health as Record<string, unknown>;
  return CAMERA_FLAGS.filter(([key]) => flags[key] === true).map(([, label]) => label);
}

/** One line: the first two reasons, then "+N". */
export function formatReasons(reasons: string[] | null): string {
  if (reasons === null || reasons.length === 0) return "No data";
  return reasons.length > 2 ? `${reasons.slice(0, 2).join(", ")} +${reasons.length - 2}` : reasons.join(", ");
}
