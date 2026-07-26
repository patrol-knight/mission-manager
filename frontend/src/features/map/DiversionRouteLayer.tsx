import { useContext } from "react";
import type maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useDeviceStore } from "../../stores/deviceStore";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";

const DIVERSION_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": "#FFD700",
  "line-width": 6,
  "line-opacity": 0.9,
  "line-dasharray": [2, 1],
};

/** Shows the robot's current diversion leg (outbound to an anomaly, or
 * returning from one) in yellow -- see backend core/anomaly_response.py.
 * Whichever leg is active, `diversion.route` is always "the one route to
 * show right now"; CurrentMissionRouteLayer grays the normal mission route
 * out for the same phase window. moveToTop keeps this above the mission
 * route/lanelet GL layers regardless of mount order -- DOM marker layers
 * (device, waypoint, diversion target) sit above the GL canvas either way. */
export function DiversionRouteLayer() {
  const { map } = useContext(MapContext);
  const route = useDeviceStore((s) => s.diversion.route);

  useGeoJsonLineLayer(map, "diversion-route", "diversion-route-line", route, DIVERSION_PAINT, true);

  return null;
}
