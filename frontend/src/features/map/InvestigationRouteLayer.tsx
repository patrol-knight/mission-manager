import { useContext, useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { remainingRoute } from "./geo";
import { mapPalette, routeLineWidth } from "./mapPalette";

/** Screen margin the whole route should fit within when it starts. */
const FIT_PADDING_PX = 80;

const ROUTE_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.investigation,
  "line-width": routeLineWidth,
  "line-opacity": 0.95,
};

/** The robot's way to the investigated anomaly, in solid yellow, over the
 * faded mission route. The backend plans the
 * route once, when the investigation starts; here it is trimmed to what lies
 * ahead of the robot on every position update, so the line always runs from
 * the robot to the target. Kept above the lanelet layers regardless of
 * mount order. */
export function InvestigationRouteLayer() {
  const { map } = useContext(MapContext);
  // On site there is nothing left to drive (a blocked arrival stops short).
  const route = useInvestigationStore((s) =>
    s.investigation?.phase === "en_route" ? s.investigation.route : null,
  );
  const robotLon = useDeviceStore((s) => selectRobot(s)?.pose?.lon ?? null);
  const robotLat = useDeviceStore((s) => selectRobot(s)?.pose?.lat ?? null);

  const remaining = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(() => {
    if (!route || robotLon === null || robotLat === null) return route;
    const coords = route.geometry.coordinates as [number, number][];
    return { ...route, geometry: { ...route.geometry, coordinates: remainingRoute(coords, [robotLon, robotLat]) } };
  }, [route, robotLon, robotLat]);

  useGeoJsonLineLayer(map, "investigation-route", "investigation-route-line", remaining, ROUTE_PAINT, true);

  // A new investigation: if any of its route is off screen, ease out until
  // all of it shows, as a navigation app does on Start. Never zooms in.
  const startedAt = useInvestigationStore((s) => s.investigation?.startedAt ?? null);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!map || !route || !startedAt || fitted.current === startedAt) return;
    fitted.current = startedAt;
    const coords = route.geometry.coordinates as [number, number][];
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const offScreen = coords.some(([lon, lat]) => {
      const p = map.project([lon, lat]);
      return p.x < FIT_PADDING_PX || p.y < FIT_PADDING_PX || p.x > w - FIT_PADDING_PX || p.y > h - FIT_PADDING_PX;
    });
    if (!offScreen) return;
    const bounds = new maplibregl.LngLatBounds();
    coords.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds, { padding: FIT_PADDING_PX, maxZoom: map.getZoom(), duration: 600 });
  }, [map, route, startedAt]);
  return null;
}
