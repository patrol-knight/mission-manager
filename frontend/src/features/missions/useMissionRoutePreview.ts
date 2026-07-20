import { useEffect, useState } from "react";
import { routePreview } from "../../api/mapApi";
import { withLoopClosure } from "./routeLoop";
import type { Waypoint } from "./missionTypes";

/** Auto-fetches a looped route preview for the given waypoints — used by the
 * Monitor view to show the persisted mission's route without an explicit
 * Validate step (unlike the Editor, which gates its own route behind one). */
export function useMissionRoutePreview(waypoints: Waypoint[] | null): {
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
} {
  const [fetchedRoute, setFetchedRoute] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
  const hasEnoughWaypoints = (waypoints?.length ?? 0) >= 2;
  const key = waypoints ? waypoints.map((wp) => `${wp.waypointId}:${wp.x}:${wp.y}`).join("|") : "";

  useEffect(() => {
    if (!hasEnoughWaypoints || !waypoints) return;
    let cancelled = false;

    routePreview(withLoopClosure(waypoints).map((wp) => ({ x: wp.x, y: wp.y, yaw: wp.yaw ?? undefined })))
      .then((result) => {
        if (!cancelled) setFetchedRoute(result.ok ? result.route : null);
      })
      .catch(() => {
        if (!cancelled) setFetchedRoute(null);
      });

    return () => {
      cancelled = true;
    };
    // `waypoints` itself is intentionally omitted — `key` is the stable,
    // content-based dependency that actually determines when to re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasEnoughWaypoints]);

  return { route: hasEnoughWaypoints ? fetchedRoute : null };
}
