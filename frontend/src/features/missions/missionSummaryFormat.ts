/**
 * Nominal patrol speed used only to estimate an ETA in the Mission Library —
 * an approximation, not the real robot's speed profile (which the backend
 * doesn't expose via any API; the simulator's own speed constant is
 * deliberately not reused here since it's simulator-only).
 */
export const ASSUMED_SPEED_MPS = 1.0;

export function formatDistance(meters: number | null): string {
  if (meters === null) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function estimateEtaSeconds(
  distanceM: number | null,
  loopCount: number,
  speedMps: number = ASSUMED_SPEED_MPS,
): number | null {
  if (distanceM === null || speedMps <= 0) return null;
  return (distanceM * loopCount) / speedMps;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return "<1 min";
  if (totalMinutes < 60) return `~${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `~${hours}h` : `~${hours}h ${minutes}m`;
}

/** "3", or "inf" for a mission that loops until stopped. */
export function formatLoopTotal(mission: { loopCount: number; infiniteLoop: boolean }): string {
  return mission.infiniteLoop ? "inf" : String(mission.loopCount);
}
