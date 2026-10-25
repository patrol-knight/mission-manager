import { useContext } from "react";
import { MapContext } from "./MapContext";
import { useMissionEditor } from "../missions/useMissionEditor";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { mapPalette, routeLineWidth } from "./mapPalette";

/** Only mounted while the Mission Editor is open. Renders the draft's last
 * Validate Route result. The Monitor view's equivalent is CurrentMissionRouteLayer,
 * which shares the underlying rendering via useGeoJsonLineLayer. */
export function MissionRouteLayer() {
  const { map } = useContext(MapContext);
  const { state } = useMissionEditor();

  useGeoJsonLineLayer(map, "mission-route", "mission-route-line", state.validationResult?.route ?? null, {
    "line-color": mapPalette.edit,
    "line-width": routeLineWidth,
    "line-opacity": 0.9,
  });

  return null;
}
