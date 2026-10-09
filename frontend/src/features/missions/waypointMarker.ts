const ACTIVE_WAYPOINT_COLOR = "#f08c00";
// Matches CurrentMissionRouteLayer's INVESTIGATING_COLOR, so the route and
// its waypoints gray out together while the robot is investigating.
const INVESTIGATING_WAYPOINT_COLOR = "#868e96";

/** Shared marker color between the interactive editor layer
 * (features/map/WaypointEditorLayer.tsx) and the read-only monitor layer
 * (features/map/MissionWaypointMarkersLayer.tsx) so both render identically
 * — every waypoint the same orange as the mission route, regardless of
 * home/selected status. Grays out when `muted` (the robot is investigating). */
export function waypointMarkerColor(muted = false): string {
  return muted ? INVESTIGATING_WAYPOINT_COLOR : ACTIVE_WAYPOINT_COLOR;
}

export function buildWaypointMarkerElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "wp-marker";
  el.style.cssText = `
    width:26px;height:26px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    color:white;font-weight:bold;font-size:12px;font-family:monospace;
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    cursor:pointer;
    z-index:1;
  `;
  return el;
}
