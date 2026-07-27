import { useContext } from "react";
import { MapContext } from "./MapContext";
import { useMissionEditor } from "../missions/useMissionEditor";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";

/** Only mounted while the Mission Editor is open. Renders the draft's last
 * Validate Route result. The Monitor view's equivalent is CurrentMissionRouteLayer,
 * which shares the underlying rendering via useGeoJsonLineLayer. */
export function MissionRouteLayer() {
  const { map } = useContext(MapContext);
  const { state } = useMissionEditor();

  useGeoJsonLineLayer(map, "mission-route", "mission-route-line", state.validationResult?.route ?? null, {
    "line-color": "#FF8C00",
    "line-width": 8,
    "line-opacity": 0.9,
  });

  return null;
}
