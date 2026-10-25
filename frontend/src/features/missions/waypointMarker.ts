import { mapPalette } from "../map/mapPalette";

/** Numbered waypoint disc in `color` (the mission's mode color) with a
 * white ring and white digits. `passive` (monitor and library) makes it smaller and click-through:
 * there it is context only, and it would otherwise sit on top of the robot
 * parked at waypoint 1. */
export function buildWaypointMarkerElement(passive = false, color: string = mapPalette.waypoint): HTMLElement {
  const size = passive ? 22 : 26;
  const el = document.createElement("div");
  el.className = "wp-marker";
  el.style.cssText = `
    width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;
    display:flex;align-items:center;justify-content:center;
    background:${color};
    color:${mapPalette.waypointText};font:700 ${passive ? 11 : 12}px system-ui,sans-serif;
    border:2px solid ${mapPalette.markerBorder};
    box-shadow:${mapPalette.markerShadow};
    cursor:${passive ? "default" : "pointer"};
    pointer-events:${passive ? "none" : "auto"};
    z-index:1;
  `;
  return el;
}

/** Marks the waypoint the robot is heading to with a pulsing ring (see
 * @keyframes waypoint-target-pulse), or clears it. */
export function setWaypointTarget(el: HTMLElement, isTarget: boolean): void {
  el.style.animation = isTarget ? "waypoint-target-pulse 1.6s ease-out infinite" : "";
  el.style.zIndex = isTarget ? "2" : "1";
}
