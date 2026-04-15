import { useEffect, useRef, useState, useCallback } from "react";
import { MapView } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useWaypointStore } from "./stores/waypointStore";
import { useApiConnection } from "./hooks/useApiConnection";
import { useRobotPose } from "./hooks/useRobotPose";
import { useRouteProgress } from "./hooks/useRouteProgress";
import { useWaypointValidation } from "./hooks/useWaypointValidation";
import { fetchRoute, publishWaypoints, projectToXY } from "./api/rest";
import type { RouteProgress } from "./stores/waypointStore";

export type RoutePhase = "idle" | "check" | "checked";

function AppInner() {
  const waypoints        = useWaypointStore((s) => s.waypoints);
  const setRouteProgress = useWaypointStore((s) => s.setRouteProgress);
  const routeProgress    = useWaypointStore((s) => s.routeProgress);
  const clear            = useWaypointStore((s) => s.clear);
  const { show }         = useToast();
  const { status }       = useApiConnection();
  const prevStatusRef    = useRef(status);
  const robotPose        = useRobotPose();
  const { validate }     = useWaypointValidation();

  useRouteProgress();

  const [routeGeojson, setRouteGeojson] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
  const [routePhase, setRoutePhase]     = useState<RoutePhase>("idle");
  const [isLoading, setIsLoading]       = useState(false);

  const handleMapReady = useCallback((_fitFn: () => void) => {}, []);

  useEffect(() => {
    if (waypoints.length > 0) {
      if (routePhase === "checked") {
        setRouteGeojson(null);
        setRouteProgress(null);
        show("warning", "Route discarded", "New waypoint added — re-check route to confirm");
      }
      setRoutePhase("check");
    } else if (waypoints.length === 0 && routePhase === "check") {
      setRoutePhase("idle");
    }
  }, [waypoints.length, routePhase, setRouteProgress, show]);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;
    if (status === "connected") show("success", "API Connected", "WebSocket live");
    else if (status === "disconnected" && prev === "connected") show("error", "API Disconnected", "Attempting to reconnect…");
  }, [status, show]);

  const buildWps = useCallback(async () => {
    let wps = waypoints.map((wp) => ({ x: wp.x, y: wp.y }));
    if (robotPose) {
      try {
        const isValid = await validate(robotPose.x, robotPose.y);
        if (isValid) wps = [{ x: robotPose.x, y: robotPose.y }, ...wps];
      } catch {}
    }
    return wps;
  }, [waypoints, robotPose, validate]);

  const handleCheckRoute = async () => {
    if (waypoints.length === 0) return;
    setIsLoading(true);
    try {
      const wps = await buildWps();
      if (wps.length < 2) {
        show("warning", "Not enough waypoints", "Add at least one waypoint");
        return;
      }

      const data = await fetchRoute(wps);
      if (!data.ok || !data.route) {
        show("error", "Route failed", "Could not compute route");
        return;
      }

      const routeCoords = await Promise.all(
        data.route.geometry.coordinates.map(async ([lng, lat]) => {
          const xy = await projectToXY(lng, lat);
          return xy;
        })
      );

      const robotPrepended = robotPose && wps[0].x === robotPose.x && wps[0].y === robotPose.y;
      const userWps = robotPrepended ? wps.slice(1) : wps;

      const snappedGoals = userWps.map((wp) => {
        let bestDist = Infinity;
        let bestXY = wp;
        for (const rc of routeCoords) {
          const d = Math.sqrt((rc.x - wp.x) ** 2 + (rc.y - wp.y) ** 2);
          if (d < bestDist) { bestDist = d; bestXY = rc; }
        }
        return bestXY;
      });

      const rp: RouteProgress = {
        goals: snappedGoals.map((wp, i) => ({
          ...wp,
          state: i === 0 ? "current" : "pending",
        })),
        currentGoalIdx: 0,
        routeCoords,
        active: false,
        speed: 0,
      };

      setRouteGeojson(data.route);
      setRouteProgress(rp);
      clear();
      setRoutePhase("checked");
      show("success", "Route ready", `${userWps.length} waypoint${userWps.length !== 1 ? "s" : ""} — press Confirm to publish`);
    } catch (err) {
      show("error", "Route error", (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmRoute = async () => {
    if (routePhase !== "checked" || !routeProgress) return;
    setIsLoading(true);
    try {
      const goalsToPublish = routeProgress.goals.map((g) => ({ x: g.x, y: g.y }));
      await publishWaypoints(goalsToPublish);
      setRouteProgress({ ...routeProgress, active: true });
      setRoutePhase(waypoints.length > 0 ? "check" : "idle");
      show("success", "Route confirmed", `${routeProgress.goals.length} waypoint${routeProgress.goals.length !== 1 ? "s" : ""} published`);
    } catch (err) {
      show("error", "Publish error", (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    clear();
    setRouteGeojson(null);
    setRouteProgress(null);
    setRoutePhase("idle");
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <Sidebar
        routePhase={routePhase}
        isLoading={isLoading}
        onCheckRoute={handleCheckRoute}
        onConfirmRoute={handleConfirmRoute}
        onClear={handleClear}
        robotPose={robotPose}
        routeProgress={routeProgress}
        waypointCount={waypoints.length}
      />
      <div style={{ flex: 1, position: "relative" }}>
        <MapView
          onMapReady={handleMapReady}
          routeGeojson={routeGeojson}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
