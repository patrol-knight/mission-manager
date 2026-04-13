import { useEffect, useRef, useState, useCallback } from "react";
import { MapView } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useWaypointStore } from "./stores/waypointStore";
import { useApiConnection } from "./hooks/useApiConnection";
import { useRobotPose } from "./hooks/useRobotPose";
import { useWaypointValidation } from "./hooks/useWaypointValidation";
import { fetchRoute, publishWaypoints, projectToXY } from "./api/rest";
import type { RouteProgress } from "./stores/waypointStore";

function AppInner() {
  const waypoints = useWaypointStore((s) => s.waypoints);
  const setRouteProgress = useWaypointStore((s) => s.setRouteProgress);
  const routeProgress = useWaypointStore((s) => s.routeProgress);
  const clear = useWaypointStore((s) => s.clear);
  const { show } = useToast();
  const { status } = useApiConnection();
  const prevStatusRef = useRef(status);
  const robotPose = useRobotPose();
  const { validate } = useWaypointValidation();

  const fitMapRef = useRef<(() => void) | null>(null);
  const [routeGeojson, setRouteGeojson] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);

  const handleMapReady = useCallback((fitFn: () => void) => {
    fitMapRef.current = fitFn;
  }, []);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;
    if (status === "connected") show("success", "API Connected", "WebSocket live");
    else if (status === "disconnected" && prev === "connected") show("error", "API Disconnected", "Attempting to reconnect…");
  }, [status, show]);

  const handleConfirm = async () => {
    if (waypoints.length === 0) return;

    let wps = waypoints.map((wp) => ({ x: wp.x, y: wp.y }));

    if (robotPose) {
      try {
        const isValid = await validate(robotPose.x, robotPose.y);
        if (isValid) wps = [{ x: robotPose.x, y: robotPose.y }, ...wps];
      } catch {}
    }

    if (wps.length < 2) { show("warning", "Not enough waypoints", "Add at least one waypoint"); return; }

    try {
      const data = await fetchRoute(wps);
      if (!data.ok || !data.route) { show("error", "Route failed", "Could not compute route"); return; }

      setRouteGeojson(data.route);

      const robotPrepended = robotPose && wps[0].x === robotPose.x && wps[0].y === robotPose.y;
      const userWps = robotPrepended ? wps.slice(1) : wps;

      const routeCoords = await Promise.all(
        data.route.geometry.coordinates.map(async ([lng, lat]) => {
        const xy = await projectToXY(lng, lat);
          return xy;
        })
      );

      const rp: RouteProgress = {
        goals: userWps.map((wp, i) => ({ ...wp, state: i === 0 ? "current" : "pending" })),
        currentGoalIdx: 0,
        routeCoords,
        active: true,
        speed: 0,
      };
      setRouteProgress(rp);

      try {
        await publishWaypoints(userWps);
      } catch (e) {
        console.warn("publishWaypoints failed:", e);
      }

      clear();
      show("success", "Route confirmed", `${userWps.length} waypoint${userWps.length !== 1 ? "s" : ""} published`);
    } catch (err) {
      show("error", "Route error", (err as Error).message);
    }
  };

  const handleClearRoute = () => {
    setRouteGeojson(null);
    setRouteProgress(null);
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <Sidebar
        onConfirm={handleConfirm}
        robotPose={robotPose}
        onClearRoute={handleClearRoute}
        routeProgress={routeProgress}
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
