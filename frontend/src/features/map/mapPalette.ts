import type maplibregl from "maplibre-gl";
import type { DeviceType } from "../../types/domain";

/** Colors drawn on the map canvas -- MapLibre paint properties and the marker
 * elements built outside React. Kept in TS rather than styles/tokens.css
 * because GL paint can't resolve CSS custom properties.
 *
 * Colors follow the app's modes (see .mode-* in tokens.css): orange = the
 * mission being run, yellow = the investigation, violet = missions being
 * edited or browsed (dashed while not active). Blue = the robot, red = an
 * anomaly. */
export const mapPalette = {
  lanelet: "#555555",
  route: "#ff8a1f",
  waypoint: "#ff8a1f",
  /** Digits on a waypoint disc. */
  waypointText: "#ffffff",
  /** Missions in the library and the editor (the editing mode's violet). */
  edit: "#b347d9",
  investigation: "#ffd23f",
  /** The clicked anomaly, the selected waypoint in the editor. */
  selectedRing: "#1c7ed6",
  /** Ring that separates a marker from the (light) map. */
  markerBorder: "#ffffff",
  markerText: "#ffffff",
  markerShadow: "0 2px 8px rgba(0,0,0,0.6)",
  anomaly: "#ff4d4f",
  /** Google-Maps-like saturated blue for the robot. */
  device: { robot: "#1a73e8", iot: "#b197fc" } satisfies Record<DeviceType, string>,
  /** A tower camera's field of view. */
  fovFill: "rgba(177,151,252,0.10)",
  fovLine: "rgba(177,151,252,0.45)",
} as const;

/** Width of every route line (mission, preview, editor, investigation):
 * thin in the overview, widening as you zoom in so a route keeps reading
 * as a lane rather than a hairline. Pixels per zoom level. */
export const routeLineWidth: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  15,
  3,
  19,
  6,
  22,
  18,
];
