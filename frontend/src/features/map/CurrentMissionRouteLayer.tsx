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

/** While the robot investigates: the same line in pale orange, the patrol it
 * will go back to, under the yellow investigation route (its waypoints are
 * hidden). Opaque, since a see-through orange over the grey lanelet lines it
 * follows turns to mud. */
const FAINT_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.routeFaint,
  "line-width": routeLineWidth,
  "line-opacity": 1,
};

/** Monitor view: the active mission's route, in orange; faint while the
 * robot investigates. */
export function CurrentMissionRouteLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const investigating = useInvestigationStore((s) => s.investigation !== null);
  const { route } = useMissionRoutePreview(definition?.waypoints ?? null);

  useGeoJsonLineLayer(map, "current-mission-route", "current-mission-route-line", route, investigating ? FAINT_PAINT : PAINT);
  return null;
}
