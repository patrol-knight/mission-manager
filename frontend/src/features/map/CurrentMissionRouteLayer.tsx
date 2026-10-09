import { useContext, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useMissionRoutePreview } from "../missions/useMissionRoutePreview";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";

const ACTIVE_COLOR = "#FF8C00";
export const INVESTIGATING_COLOR = "#868e96";

/** Monitor-view counterpart to the Editor's MissionRouteLayer — shows the
 * persisted (current) mission's route, auto-computed rather than gated behind
 * an explicit Validate step. Shares rendering via useGeoJsonLineLayer.
 *
 * Grays out while the robot is investigating — MissionWaypointMarkersLayer
 * grays its waypoints the same way, and InvestigationRouteLayer/
 * InvestigationTargetLayer show the yellow route/target meanwhile. */
export function CurrentMissionRouteLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const investigating = useInvestigationStore((s) => s.investigation !== null);
  const { route } = useMissionRoutePreview(definition?.waypoints ?? null);

  const paint = useMemo<maplibregl.LineLayerSpecification["paint"]>(
    () => ({
      "line-color": investigating ? INVESTIGATING_COLOR : ACTIVE_COLOR,
      "line-width": 8,
      "line-opacity": 0.9,
    }),
    [investigating],
  );

  useGeoJsonLineLayer(map, "current-mission-route", "current-mission-route-line", route, paint);

  return null;
}
