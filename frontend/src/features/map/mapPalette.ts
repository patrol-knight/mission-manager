import type * as maplibregl from "maplibre-gl";
import type { DeviceType } from "../../types/domain";

/** Colors drawn on the map canvas -- MapLibre paint properties and the marker
 * elements built outside React. Kept in TS rather than styles/tokens.css
 * because GL paint can't resolve CSS custom properties.
 *
 * Colors follow the app's modes (see .mode-* in tokens.css): orange = the
 * mission being run, yellow = the investigation, mauve = missions being
 * edited or browsed (dashed while not active). Blue = the robot, indigo = an
 * IoT tower, muted red = an anomaly. */
export const mapPalette = {
  lanelet: "#555555",
  route: "#ff8a1f",
  waypoint: "#ff8a1f",
  /** Digits on a waypoint disc. */
  waypointText: "#ffffff",
  /** Missions in the library and the editor -- the editing mode's mauve
   * (--mode-edit in tokens.css). */
  edit: "#a97a9f",
  investigation: "#ffd23f",
  /** Ring that separates a marker from the (light) map. */
  markerBorder: "#ffffff",
  markerText: "#ffffff",
  markerShadow: "0 2px 8px rgba(0,0,0,0.6)",
  /** The UI's danger red (--color-danger), so a marker and its card match. */
  anomaly: "#c51e3a",
  /** The part of an anomaly's lifetime ring already used up. */
  anomalyLifeTrack: "#ffffff",
  /** Google-Maps-like saturated blue for the robot. */
  device: { robot: "#1a73e8", iot: "#5a4fcf" } satisfies Record<DeviceType, string>,
  /** Ring around a tower whose row is hovered in the towers list. */
  towerHalo: "rgba(90,79,207,0.3)",
  /** A tower camera's field of view. */
  fovFill: "rgba(90,79,207,0.08)",
  fovLine: "rgba(90,79,207,0.45)",
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
