/** Shared marker styling between the interactive editor layer
 * (features/map/WaypointEditorLayer.tsx) and the read-only monitor layer
 * (features/map/MissionWaypointMarkersLayer.tsx) so both render identically. */
export function waypointMarkerColor(home: boolean, selected: boolean): string {
  if (home) return "#f08c00";
  if (selected) return "#1c7ed6";
  return "#4dabf7";
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
  `;
  return el;
}
