import { useContext } from "react";
import type maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";

const ROUTE_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": "#FFD700",
  "line-width": 6,
  "line-opacity": 0.9,
  "line-dasharray": [2, 1],
};

/** The robot's route to the investigated anomaly, in yellow, while the
 * mission route is grayed out (CurrentMissionRouteLayer). Kept above the
 * mission route/lanelet GL layers regardless of mount order. */
export function InvestigationRouteLayer() {
  const { map } = useContext(MapContext);
  const route = useInvestigationStore((s) => s.investigation?.route ?? null);

  useGeoJsonLineLayer(map, "investigation-route", "investigation-route-line", route, ROUTE_PAINT, true);
  return null;
}
