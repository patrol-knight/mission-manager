import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useDeviceStore } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";

interface DiversionTargetPoint {
  id: string;
  lat: number;
  lon: number;
}

function buildDiversionTargetElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:20px;height:20px;border-radius:50%;
    background:#FFD700;
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    animation: diversion-target-pulse 1.4s ease-out infinite;
    z-index:3;
  `;
  return el;
}

/** A single yellow marker at wherever the robot is currently headed during
 * a diversion: the anomaly's snapped lanelet point (outbound leg, straight
 * from deviceStore) or the mission waypoint it's returning to (returning
 * leg -- DiversionReturning only carries a waypoint id, so it's resolved
 * against the current mission definition). Complements DiversionRouteLayer's
 * yellow route line with a marker at the actual endpoint. Both legs' lat/lon
 * are computed server-side already (MapServer.snap_to_lanelet /
 * api/mission.py's WaypointGeo) -- no xy-to-lnglat call needed here. */
export function DiversionTargetMarkerLayer() {
  const { map } = useContext(MapContext);
  const diversion = useDeviceStore((s) => s.diversion);
  const definition = useMissionStore((s) => s.definition);

  const points = useMemo<DiversionTargetPoint[]>(() => {
    if (diversion.phase === "outbound" && diversion.target?.lat != null && diversion.target?.lon != null) {
      return [{ id: "diversion-target", lat: diversion.target.lat, lon: diversion.target.lon }];
    }
    if (diversion.phase === "returning" && diversion.targetWaypointId) {
      const wp = definition?.waypoints.find((w) => w.waypointId === diversion.targetWaypointId);
      if (wp?.lat != null && wp?.lon != null) {
        return [{ id: "diversion-target", lat: wp.lat, lon: wp.lon }];
      }
    }
    return [];
  }, [diversion, definition]);

  const options = useMemo<UseMarkerListOptions<DiversionTargetPoint>>(
    () => ({
      keyOf: (p) => p.id,
      dependsOn: (p) => [p.lat, p.lon],
      project: async (p) => ({ lng: p.lon, lat: p.lat }),
      buildElement: buildDiversionTargetElement,
    }),
    [],
  );

  useMarkerList(map, points, options);
  return null;
}
