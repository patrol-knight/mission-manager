import { useContext, useEffect, useMemo, useState } from "react";
import maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useLibraryStore } from "../../stores/libraryStore";
import { useMissionStore } from "../../stores/missionStore";
import { useMissionRoutePreview } from "../missions/useMissionRoutePreview";
import { buildWaypointMarkerElement } from "../missions/waypointMarker";
import { getMission } from "../../api/missionApi";
import { mapPalette, routeLineWidth } from "./mapPalette";
import type { Waypoint } from "../missions/missionTypes";

const ACTIVE_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.route,
  "line-width": routeLineWidth,
  "line-opacity": 0.95,
};

/** Violet dashed = a mission not in effect; activating turns it solid orange. */
const INACTIVE_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  ...ACTIVE_PAINT,
  "line-color": mapPalette.edit,
  "line-dasharray": [2, 1.5],
};

const NO_WAYPOINTS: Waypoint[] = [];

/** Library view only: the mission selected in the list -- its route and
 * numbered waypoints, framed on screen -- so the operator sees where a
 * mission goes before activating or editing it. Only that one mission is
 * drawn: solid orange (the run mode) if it is the active mission, violet
 * dashed (the editing mode) otherwise -- so activating it visibly hands it
 * over to the robot. */
export function MissionPreviewLayer() {
  const { map } = useContext(MapContext);
  const missionId = useLibraryStore((s) => s.selectedMissionId);
  const isActive = useMissionStore((s) => missionId !== null && s.definition?.missionId === missionId);
  const [loaded, setLoaded] = useState<{ missionId: string; waypoints: Waypoint[] } | null>(null);

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    getMission(missionId)
      .then((mission) => {
        if (!cancelled) setLoaded({ missionId, waypoints: mission.waypoints });
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const waypoints = loaded && loaded.missionId === missionId ? loaded.waypoints : NO_WAYPOINTS;
  const { route } = useMissionRoutePreview(waypoints.length > 0 ? waypoints : null);
  useGeoJsonLineLayer(map, "library-preview", "library-preview-line", route, isActive ? ACTIVE_PAINT : INACTIVE_PAINT, true);

  const markerOptions = useMemo<UseMarkerListOptions<Waypoint>>(
    () => ({
      keyOf: (wp) => wp.waypointId,
      dependsOn: (wp) => [wp.lat, wp.lon],
      project: async (wp) => (wp.lat != null && wp.lon != null ? { lng: wp.lon, lat: wp.lat } : null),
      buildElement: () => buildWaypointMarkerElement(true),
      updateElement: (el, wp) => {
        el.style.background = isActive ? mapPalette.waypoint : mapPalette.edit;
        el.textContent = String(waypoints.findIndex((w) => w.waypointId === wp.waypointId) + 1);
      },
    }),
    [waypoints, isActive],
  );
  useMarkerList(map, waypoints, markerOptions, [isActive]);

  useEffect(() => {
    if (!map || !route) return;
    const bounds = new maplibregl.LngLatBounds();
    route.geometry.coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));
    if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 80, maxZoom: 20, duration: 600 });
  }, [map, route]);

  return null;
}
