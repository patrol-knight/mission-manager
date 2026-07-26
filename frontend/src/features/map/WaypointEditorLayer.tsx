import { useContext, useEffect, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useMissionEditor } from "../missions/useMissionEditor";
import { isHomeWaypoint } from "../missions/missionEditorReducer";
import { useToast } from "../../components/useToast";
import { xyToLngLat, lngLatToXy, isInLanelet } from "../../api/mapApi";
import { waypointMarkerColor, buildWaypointMarkerElement } from "../missions/waypointMarker";
import type { Waypoint } from "../missions/missionTypes";

/** A validation-service error is treated as "invalid" (fail-safe) — matches the
 * old app's behavior of never blocking on a thrown error, just rejecting. */
async function checkInLanelet(x: number, y: number): Promise<boolean> {
  try {
    return await isInLanelet(x, y);
  } catch {
    return false;
  }
}

/** Only mounted while the Mission Editor is open. Operates on the editor's draft
 * waypoints (MissionEditorContext), never on the persisted mission definition. */
export function WaypointEditorLayer() {
  const { map } = useContext(MapContext);
  const { state, dispatch } = useMissionEditor();
  const { show } = useToast();

  const options = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      dependsOn: (wp) => [wp.x, wp.y],
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
        const index = state.waypoints.findIndex((w) => w.waypointId === wp.waypointId);
        el.style.background = waypointMarkerColor();
        el.textContent = String(index + 1);
      },
      draggable: () => state.tool === "modify",
      onDragEnd: async (wp, lngLat, marker) => {
        let x: number, y: number;
        try {
          ({ x, y } = await lngLatToXy(lngLat.lat, lngLat.lng));
        } catch {
          return; // couldn't determine local coords — leave the marker where it was dropped
        }

        if (!(await checkInLanelet(x, y))) {
          const current = state.waypoints.find((w) => w.waypointId === wp.waypointId);
          if (current) {
            try {
              const orig = await xyToLngLat(current.x, current.y);
              marker.setLngLat([orig.lon, orig.lat]);
            } catch {
              // can't re-project the original position either — leave as dropped.
            }
          }
          show("warning", "Outside lanelet", "Waypoint snapped back — outside drivable area");
          return;
        }

        dispatch({ type: "MOVE_WAYPOINT", id: wp.waypointId, x, y });
      },
      onClick: (wp) => {
        if (state.tool === "delete") {
          if (isHomeWaypoint(state.waypoints, wp.waypointId)) {
            show("warning", "Cannot delete Home", "Waypoint #1 is the mission's Home and cannot be removed.");
            return;
          }
          dispatch({ type: "DELETE_WAYPOINT", id: wp.waypointId });
          return;
        }
        dispatch({ type: "SELECT_WAYPOINT", id: wp.waypointId });
      },
    }),
    [state.waypoints, state.tool, dispatch, show],
  );

  useMarkerList(map, state.waypoints, options);

  useEffect(() => {
    if (!map) return;

    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      if (state.tool !== "modify") return;
      if ((e.originalEvent.target as HTMLElement).closest(".wp-marker")) return;

      let x: number, y: number;
      try {
        ({ x, y } = await lngLatToXy(e.lngLat.lat, e.lngLat.lng));
      } catch {
        return; // projection unavailable — click silently ignored
      }

      if (!(await checkInLanelet(x, y))) {
        show("warning", "Outside lanelet", "Waypoint not placed — outside drivable area");
        return;
      }

      dispatch({ type: "ADD_WAYPOINT", x, y });
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map, state.tool, dispatch, show]);

  return null;
}
