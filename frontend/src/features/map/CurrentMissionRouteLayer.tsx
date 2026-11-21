import { useContext } from "react";
import type * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useMissionRoutePreview } from "../missions/useMissionRoutePreview";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { mapPalette, routeLineWidth } from "./mapPalette";

const PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.route,
  "line-width": routeLineWidth,
  "line-opacity": 0.95,
};

/** Monitor view: the active mission's route, in orange. Hidden while the
 * robot investigates (like its waypoints), leaving the yellow investigation
 * route as the only path on the map. */
export function CurrentMissionRouteLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const investigating = useInvestigationStore((s) => s.investigation !== null);
  const { route } = useMissionRoutePreview(definition?.waypoints ?? null);

  useGeoJsonLineLayer(map, "current-mission-route", "current-mission-route-line", investigating ? null : route, PAINT);
  return null;
}
