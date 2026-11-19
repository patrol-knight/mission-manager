import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useMissionStore } from "../../stores/missionStore";
import { selectPreviewing, useInvestigationStore } from "../../stores/investigationStore";
import { buildWaypointMarkerElement, setWaypointTarget } from "../missions/waypointMarker";
import { headingWaypointIndex } from "../missions/missionStatus";
import type { Waypoint } from "../missions/missionTypes";
import { setMarkerGlyph } from "./markerGlyph";

const NO_WAYPOINTS: Waypoint[] = [];

/** Monitor view: read-only numbered markers for the active mission, the one
 * the robot is heading to pulsing (none while it dwells). Hidden while the
 * robot investigates -- the mission is frozen then, and the yellow
 * investigation route is the only path that matters. */
export function MissionWaypointMarkersLayer() {
  const { map } = useContext(MapContext);
  const definition = useMissionStore((s) => s.definition);
  const execution = useMissionStore((s) => s.execution);
  const investigating = useInvestigationStore((s) => s.investigation !== null);
  const waypoints = useMemo(
    () => (investigating ? NO_WAYPOINTS : (definition?.waypoints ?? NO_WAYPOINTS)),
    [definition, investigating],
  );
  const target = headingWaypointIndex(execution, waypoints.length);
  // Behind an Explore preview, like the mission's route.
  const previewing = useInvestigationStore(selectPreviewing);

  const options = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      dependsOn: (wp) => [wp.lat, wp.lon],
      // Computed once, server-side, by GET/save mission responses (see
      // backend/api/mission.py's WaypointGeo) -- no xy-to-lnglat call.
      project: async (wp) => (wp.lat != null && wp.lon != null ? { lng: wp.lon, lat: wp.lat } : null),
      buildElement: () => buildWaypointMarkerElement(true),
      updateElement: (el, wp) => {
        const index = waypoints.findIndex((w) => w.waypointId === wp.waypointId);
        setMarkerGlyph(el, String(index + 1));
        setWaypointTarget(el, index === target);
        el.style.opacity = previewing ? "0.3" : "1";
      },
    }),
    [waypoints, target, previewing],
  );

  useMarkerList(map, waypoints, options, [target, previewing]);
  return null;
}
