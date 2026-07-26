import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useMissionStore } from "../../stores/missionStore";
import { waypointMarkerColor, buildWaypointMarkerElement } from "../missions/waypointMarker";
import type { Waypoint } from "../missions/missionTypes";

/** Monitor-view counterpart to the Editor's (interactive) WaypointEditorLayer —
 * read-only numbered markers for the persisted mission's waypoints. Shares
 * marker styling via features/missions/waypointMarker.ts so both look identical.
 * Grays out while INVESTIGATING, same as CurrentMissionRouteLayer's route
 * line -- the diversion's own yellow route/target marker stays the visual
 * focus, while the mission's waypoints remain visible for context. */
export function MissionWaypointMarkersLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const investigating = useMissionStore((s) => s.execution?.status === "investigating");
  const waypoints = useMemo(() => definition?.waypoints ?? [], [definition]);

  const options = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      dependsOn: (wp) => [wp.lat, wp.lon],
      // Computed once, server-side, by GET/save mission responses (see
      // backend/api/mission.py's WaypointGeo) -- no xy-to-lnglat call.
      project: async (wp) => (wp.lat != null && wp.lon != null ? { lng: wp.lon, lat: wp.lat } : null),
      buildElement: buildWaypointMarkerElement,
      updateElement: (el, wp) => {
        const index = waypoints.findIndex((w) => w.waypointId === wp.waypointId);
        el.style.background = waypointMarkerColor(investigating);
        el.textContent = String(index + 1);
      },
    }),
    [waypoints, investigating],
  );

  useMarkerList(map, waypoints, options, [investigating]);
  return null;
}
