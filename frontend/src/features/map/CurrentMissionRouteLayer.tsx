import { useContext } from "react";
import { MapContext } from "./MapContext";
import { useMissionStore } from "../../stores/missionStore";
import { useMissionRoutePreview } from "../missions/useMissionRoutePreview";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";

/** Monitor-view counterpart to the Editor's MissionRouteLayer — shows the
 * persisted (current) mission's route, auto-computed rather than gated behind
 * an explicit Validate step. Shares rendering via useGeoJsonLineLayer. */
export function CurrentMissionRouteLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const { route } = useMissionRoutePreview(definition?.waypoints ?? null);

  useGeoJsonLineLayer(map, "current-mission-route", "current-mission-route-line", route, {
    "line-color": "#FF8C00",
    "line-width": 8,
    "line-opacity": 0.9,
  });

  return null;
}
