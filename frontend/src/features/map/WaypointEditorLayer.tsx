import { useContext, useEffect, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions, type LngLat } from "./mapMarkers";
import { useMissionEditor } from "../missions/useMissionEditor";
import { useToast } from "../../components/useToast";
import { placeWaypoint, xyToLngLat, type PlacedPoint } from "../../api/mapApi";
import { buildWaypointMarkerElement } from "../missions/waypointMarker";
import { mapPalette } from "./mapPalette";
import type { Waypoint } from "../missions/missionTypes";
import { setMarkerGlyph } from "./markerGlyph";

async function placeOnLanelet(lngLat: LngLat): Promise<PlacedPoint | null> {
  try {
    return await placeWaypoint(lngLat.lat, lngLat.lng);
  } catch {
    return null;
  }
}

/** Where a waypoint is drawn: its own lat/lon, projected only if it has none. */
async function waypointLngLat(wp: Waypoint): Promise<LngLat | null> {
  if (wp.lat != null && wp.lon != null) return { lng: wp.lon, lat: wp.lat };
  try {
    const { lat, lon } = await xyToLngLat(wp.x, wp.y);
    return { lng: lon, lat };
  } catch {
    return null;
  }
}

/** Only mounted while the Mission Editor is open, on the editor's draft
 * waypoints. There are no modes: click the map to add, drag a waypoint to
 * move it, click one to select it (Delete removes the selected one -- see
 * MissionEditorPanel). */
export function WaypointEditorLayer() {
  const { map } = useContext(MapContext);
  const { state, dispatch } = useMissionEditor();
  const { show } = useToast();

  const options = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      dependsOn: (wp) => [wp.x, wp.y],
      project: waypointLngLat,
      buildElement: () => buildWaypointMarkerElement(false, mapPalette.edit),
      updateElement: (el, wp) => {
        const index = state.waypoints.findIndex((w) => w.waypointId === wp.waypointId);
        const selected = wp.waypointId === state.selectedWaypointId;
        // The selected waypoint is drawn larger. Sized, not scaled: MapLibre
        // positions markers through their element's transform.
        const size = selected ? 30 : 26;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.fontSize = selected ? "14px" : "12px";
        el.style.zIndex = selected ? "2" : "1";
        setMarkerGlyph(el, String(index + 1));
      },
      draggable: () => true,
      onDragEnd: async (wp, lngLat, marker) => {
        const placed = await placeOnLanelet(lngLat);
        if (!placed) {
          const orig = await waypointLngLat(wp);
          if (orig) marker.setLngLat([orig.lng, orig.lat]);
          show("warning", "Outside lanelet", "Waypoint snapped back — outside drivable area");
          return;
        }
        dispatch({ type: "MOVE_WAYPOINT", id: wp.waypointId, ...placed });
      },
      onClick: (wp) => dispatch({ type: "SELECT_WAYPOINT", id: wp.waypointId }),
    }),
    [state.waypoints, state.selectedWaypointId, dispatch, show],
  );

  useMarkerList(map, state.waypoints, options, [state.selectedWaypointId]);

  useEffect(() => {
    if (!map) return;

    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as HTMLElement).closest(".wp-marker")) return;
      const placed = await placeOnLanelet({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      if (!placed) {
        show("warning", "Outside lanelet", "Waypoint not placed — outside drivable area");
        return;
      }
      dispatch({ type: "ADD_WAYPOINT", ...placed });
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map, dispatch, show]);

  return null;
}
