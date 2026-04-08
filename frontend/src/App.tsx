import { useEffect, useRef, useState, useCallback } from "react";
import { MapView } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider, useToast } from "./components/Toast";
import { useWaypointStore } from "./stores/waypointStore";
import { useApiConnection } from "./hooks/useApiConnection";
import { useRobotPose } from "./hooks/useRobotPose";
import { useWaypointValidation } from "./hooks/useWaypointValidation";
import { fetchRoute, publishWaypoints } from "./api/rest";
import type { RouteProgress } from "./stores/waypointStore";

function lngLatToLocal(lng: number, lat: number, originLat: number, originLon: number) {
  const EARTH_RADIUS = 6_378_137.0;
  const cosOrigin = Math.cos((originLat * Math.PI) / 180);
  return {
    x: ((lng - originLon) * Math.PI / 180) * EARTH_RADIUS * cosOrigin,
    y: ((lat - originLat) * Math.PI / 180) * EARTH_RADIUS,
  };
}

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

    const ORIGIN_LAT = 37.384707;
    const ORIGIN_LON = -122.032313;

    let wps = waypoints.map((wp) => {
      const local = lngLatToLocal(wp.x, wp.y, ORIGIN_LAT, ORIGIN_LON);
      return { x: local.x, y: local.y };
    });

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

      const routeCoords = data.route.geometry.coordinates.map(([lng, lat]) =>
        lngLatToLocal(lng, lat, ORIGIN_LAT, ORIGIN_LON)
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
