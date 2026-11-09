import type { Device } from "../../types/domain";
import { mapPalette } from "../map/mapPalette";

// Explicit stacking, not mount order -- markers are appended to the DOM as
// each layer's useMarkerList effect resolves, so mount order is fragile.
// Waypoints 1 < IoT 4 < anomalies 5 (AnomalyLayer) < robot 10: anomalies sit
// a meter or two from the tower that saw them, so they must win over the
// tower to stay clickable, and the robot must always stay visible.
export const DEVICE_Z_INDEX: Record<Device["type"], number> = {
  robot: 10,
  iot: 4,
};

/** An arrow pointing where the robot faces, inside a soft halo. The marker
 * itself is rotated (useMarkerList's rotationOf), so the arrow points up. */
export function buildRobotElement(): HTMLElement {
  const color = mapPalette.device.robot;
  const el = document.createElement("div");
  el.style.cssText = `
    width:40px;height:40px;cursor:pointer;z-index:${DEVICE_Z_INDEX.robot};
    transition:width 150ms ease-out, height 150ms ease-out;
  `;
  el.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 40 40" style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35))">
      <circle cx="20" cy="20" r="18" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.5" />
      <path d="M20 6.2 L30 31 L20 25.2 L10 31 Z" fill="${color}" stroke="${mapPalette.markerBorder}"
        stroke-width="2" stroke-linejoin="round" />
    </svg>`;
  return el;
}
