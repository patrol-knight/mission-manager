import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useMissionStore } from "../../stores/missionStore";
import { xyToLngLat } from "../../api/mapApi";
import { waypointMarkerColor, buildWaypointMarkerElement } from "../missions/waypointMarker";
import type { Waypoint } from "../missions/missionTypes";

/** Monitor-view counterpart to the Editor's (interactive) WaypointEditorLayer —
 * read-only numbered markers for the persisted mission's waypoints. Shares
 * marker styling via features/missions/waypointMarker.ts so both look identical. */
export function MissionWaypointMarkersLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const waypoints = useMemo(() => definition?.waypoints ?? [], [definition]);

  const options = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      project: async (wp) => {
        try {
          const { lat, lon } = await xyToLngLat(wp.x, wp.y);
          return { lng: lon, lat };
        } catch {
          return null;
        }
      },
      buildElement: buildWaypointMarkerElement,
      updateElement: (el, wp) => {
        const index = waypoints.findIndex((w) => w.waypointId === wp.waypointId);
        el.style.background = waypointMarkerColor(index === 0, false);
        el.textContent = String(index + 1);
      },
    }),
    [waypoints],
  );

  useMarkerList(map, waypoints, options);
  return null;
}
