/** Appends the first waypoint again so a route preview closes the loop back to
 * Home (1→2→3→1) — matching how the backend's execution engine already treats
 * missions (current_waypoint_index wraps back to 0). No-ops below 2 waypoints,
 * since that's already an invalid mission (enforced elsewhere). */
export function withLoopClosure<T>(waypoints: T[]): T[] {
  if (waypoints.length < 2) return waypoints;
  return [...waypoints, waypoints[0]];
}
