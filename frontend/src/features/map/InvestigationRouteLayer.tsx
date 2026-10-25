import { useContext, useMemo } from "react";
import type * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { remainingRoute } from "./geo";
import { mapPalette, routeLineWidth } from "./mapPalette";

const ROUTE_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.investigation,
  "line-width": routeLineWidth,
  "line-opacity": 0.95,
};

/** The robot's way to the investigated anomaly, in solid yellow -- the only
 * path on the map then (the mission route is hidden). The backend plans the
 * route once, when the investigation starts; here it is trimmed to what lies
 * ahead of the robot on every position update, so the line always runs from
 * the robot to the target. Kept above the lanelet layers regardless of
 * mount order. */
export function InvestigationRouteLayer() {
  const { map } = useContext(MapContext);
  const route = useInvestigationStore((s) => s.investigation?.route ?? null);
  const robotLon = useDeviceStore((s) => selectRobot(s)?.pose.lon ?? null);
  const robotLat = useDeviceStore((s) => selectRobot(s)?.pose.lat ?? null);

  const remaining = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(() => {
    if (!route || robotLon === null || robotLat === null) return route;
    const coords = route.geometry.coordinates as [number, number][];
    return { ...route, geometry: { ...route.geometry, coordinates: remainingRoute(coords, [robotLon, robotLat]) } };
  }, [route, robotLon, robotLat]);

  useGeoJsonLineLayer(map, "investigation-route", "investigation-route-line", remaining, ROUTE_PAINT, true);
  return null;
}
