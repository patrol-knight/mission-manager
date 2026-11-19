export function formatDistance(meters: number | null): string {
  if (meters === null) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return "<1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** "3", or "inf" for a mission that loops until stopped. */
export function formatLoopTotal(mission: { loopCount: number; infiniteLoop: boolean }): string {
  return mission.infiniteLoop ? "inf" : String(mission.loopCount);
}

/** A dwell: "30 s", "1 min 30 s", "2 min". */
export function formatDwell(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** A countdown: "0:18", "1:05". */
export function formatCountdown(seconds: number): string {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

