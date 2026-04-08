import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useWaypointStore } from "../stores/waypointStore";
import { useRobotPose } from "../hooks/useRobotPose";
import { useLaneletMap, useOccupancyMap } from "../hooks/useMapData";
import { useMissionPath } from "../hooks/useMissionPath";
import { useWaypointValidation } from "../hooks/useWaypointValidation";
import { fetchMapOrigin, fetchMapBounds } from "../api/rest";
import { useApiConnection } from "../hooks/useApiConnection";
import { useToast } from "./Toast";

let ORIGIN_LAT = 37.384707;
let ORIGIN_LON = -122.032313;
const EARTH_RADIUS = 6_378_137.0;

function lngLatToLocal(lng: number, lat: number): { x: number; y: number } {
  const cosOrigin = Math.cos((ORIGIN_LAT * Math.PI) / 180);
  return {
    x: ((lng - ORIGIN_LON) * Math.PI / 180) * EARTH_RADIUS * cosOrigin,
    y: ((lat - ORIGIN_LAT) * Math.PI / 180) * EARTH_RADIUS,
  };
}

function localToLngLat(x: number, y: number): { lng: number; lat: number } {
  const cosOrigin = Math.cos((ORIGIN_LAT * Math.PI) / 180);
  return {
    lng: ORIGIN_LON + (x / (EARTH_RADIUS * cosOrigin)) * (180 / Math.PI),
    lat: ORIGIN_LAT + (y / EARTH_RADIUS) * (180 / Math.PI),
  };
}

const MARKER_COLORS = {
  planning: "#00FF88",
  pending:  "#00FF88",
  current:  "#FF8C00",
  done:     "#666666",
};

function makeMarkerEl(label: number, color: string, pulse: boolean): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:24px;height:24px;border-radius:50%;
    background:${color};
    font-weight:bold;font-size:12px;font-family:monospace;
    display:flex;align-items:center;justify-content:center;
    color:white;
    box-shadow:0 1px 5px rgba(0,0,0,0.6);
    cursor:default;
  `;
  el.textContent = String(label);
  if (pulse) {
    el.style.animation = "mppulse 1.2s infinite";
  }
  return el;
}

interface MapViewProps {
  onMapReady: (fitFn: () => void) => void;
  routeGeojson: GeoJSON.Feature<GeoJSON.LineString> | null;
}

export function MapView({ onMapReady, routeGeojson }: MapViewProps) {
  const mapContainerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const wpMarkersRef = React.useRef<Map<string, maplibregl.Marker>>(new Map());
  const routeMarkersRef = React.useRef<maplibregl.Marker[]>([]);
  const robotMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const mapBoundsRef = React.useRef<[[number, number], [number, number]] | null>(null);
  const laneletGeojsonRef = React.useRef<GeoJSON.FeatureCollection | null>(null);

  const add = useWaypointStore((s) => s.add);
  const update = useWaypointStore((s) => s.update);
  const remove = useWaypointStore((s) => s.remove);
  const waypoints = useWaypointStore((s) => s.waypoints);
  const mode = useWaypointStore((s) => s.mode);
  const routeProgress = useWaypointStore((s) => s.routeProgress);
  const advanceGoal = useWaypointStore((s) => s.advanceGoal);

  const robotPose = useRobotPose();
  const { geojson: laneletGeojson } = useLaneletMap();
  const occupancyMap = useOccupancyMap();
  const pathData = useMissionPath();
  const { validate } = useWaypointValidation();
  const { status } = useApiConnection();
  const { show } = useToast();

  const [mapLoading, setMapLoading] = React.useState(true);

  React.useEffect(() => {
    if (status === "disconnected") setMapLoading(true);
    // If reconnected and lanelet already loaded, clear spinner
    if (status === "connected" && laneletGeojsonRef.current && mapRef.current?.loaded()) {
      setMapLoading(false);
    }
  }, [status]);

  const fitToMap = React.useCallback(() => {
    if (!mapRef.current || !mapBoundsRef.current) return;
    mapRef.current.fitBounds(mapBoundsRef.current, { padding: 60, duration: 600 });
  }, []);

  const applyLaneletLayers = React.useCallback((map: maplibregl.Map, geojson: GeoJSON.FeatureCollection) => {
    ["ll-arrows", "ll-center", "ll-right", "ll-left"].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource("lanelet")) map.removeSource("lanelet");

    map.addSource("lanelet", { type: "geojson", data: geojson });
    map.addLayer({ id: "ll-left",   type: "line", source: "lanelet", filter: ["==", ["get", "type"], "left"],   paint: { "line-color": "#555555", "line-width": 2 } });
    map.addLayer({ id: "ll-right",  type: "line", source: "lanelet", filter: ["==", ["get", "type"], "right"],  paint: { "line-color": "#555555", "line-width": 2 } });
    map.addLayer({ id: "ll-center", type: "line", source: "lanelet", filter: ["==", ["get", "type"], "center"], paint: { "line-color": "#555555", "line-width": 1.5, "line-dasharray": [4, 3] } });

    const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="19,10 5,3 8,10 5,17" fill="#555555"/></svg>`;
    const blob = new Blob([arrowSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image(20, 20);
    img.onload = () => {
      if (!map.hasImage("arrow-icon")) map.addImage("arrow-icon", img, { sdf: false });
      if (map.getLayer("ll-arrows")) map.removeLayer("ll-arrows");
      map.addLayer({
        id: "ll-arrows", type: "symbol", source: "lanelet",
        filter: ["==", ["get", "type"], "center"],
        layout: {
          "symbol-placement": "line", "symbol-spacing": 50,
          "icon-image": "arrow-icon", "icon-size": 1,
          "icon-rotation-alignment": "map", "icon-pitch-alignment": "map",
          "icon-allow-overlap": true, "icon-ignore-placement": true,
        },
      });
      URL.revokeObjectURL(url);
    };
    img.src = url;

    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#FF8C00", "line-width": 8, "line-opacity": 0.9 } });
    }
  }, []);

  // ── Init map ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 } },
        layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
      },
      center: [ORIGIN_LON, ORIGIN_LAT],
      zoom: 17,
      maxZoom: 22,
    });
    mapRef.current = map;

    map.on("load", async () => {
      try {
        const [originData, boundsData] = await Promise.all([fetchMapOrigin(), fetchMapBounds()]);
        ORIGIN_LAT = originData.lat;
        ORIGIN_LON = originData.lon;
        mapBoundsRef.current = boundsData.bounds;
        map.fitBounds(boundsData.bounds, { padding: 60, duration: 0 });
      } catch (e) {
        console.warn("Could not fetch origin/bounds:", e);
      }

      if (laneletGeojsonRef.current) {
        applyLaneletLayers(map, laneletGeojsonRef.current);
        setMapLoading(false);
      }
    });
  }, [applyLaneletLayers]);

  React.useEffect(() => {
    onMapReady(fitToMap);
  }, [fitToMap, onMapReady]);

  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.key === "f" || e.key === "F") && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        fitToMap();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fitToMap]);

  React.useEffect(() => {
    if (!laneletGeojson) return;
    laneletGeojsonRef.current = laneletGeojson;
    const map = mapRef.current;
    if (map && map.loaded()) {
      applyLaneletLayers(map, laneletGeojson);
      setMapLoading(false);
    }
  }, [laneletGeojson, applyLaneletLayers]);

  // ── Route geojson line ────────────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (routeGeojson) src.setData(routeGeojson);
      else src.setData({ type: "FeatureCollection", features: [] });
    };
    if (map.loaded()) apply(); else map.once("load", apply);
  }, [routeGeojson]);

  // ── Route markers (orange/green/gray circles on map) ─────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];

    if (!routeProgress || !routeProgress.active) return;

    routeProgress.goals.forEach((goal, i) => {
      const { lng, lat } = localToLngLat(goal.x, goal.y);
      const color = MARKER_COLORS[goal.state];
      const pulse = goal.state === "current";
      const el = makeMarkerEl(i + 1, color, pulse);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      routeMarkersRef.current.push(marker);
    });
  }, [routeProgress]);

  // Keep refs to routeProgress and advanceGoal so the robot pose effect
  // never needs them in its dependency array (prevents infinite re-render loop).
  const routeProgressRef = React.useRef(routeProgress);
  routeProgressRef.current = routeProgress;
  const advanceGoalRef = React.useRef(advanceGoal);
  advanceGoalRef.current = advanceGoal;

  // ── Robot pose → HTML marker (always above waypoint markers) ────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !robotPose) return;

    const lng = robotPose.lon ?? robotPose.x;
    const lat = robotPose.lat ?? robotPose.y;
    const yawDeg = robotPose.yaw * (180 / Math.PI);
    const bearing = 90 - yawDeg;

    if (robotMarkerRef.current) {
      // Update position and rotation of existing marker
      robotMarkerRef.current.setLngLat([lng, lat]);
      const el = robotMarkerRef.current.getElement();
      const svg = el.querySelector("svg");
      if (svg) svg.style.transform = `rotate(${bearing}deg)`;
    } else {
      // Create HTML marker with high z-index
      const el = document.createElement("div");
      el.style.cssText = "width:36px;height:36px;z-index:9999;";
      el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" style="transform:rotate(${bearing}deg);transition:transform 0.1s linear;">
        <circle cx="18" cy="18" r="17" fill="#1a73e8" stroke="white" stroke-width="2"/>
        <polygon points="18,8 26,26 18,21 10,26" fill="white"/>
      </svg>`;
      robotMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
    }

    // Advance route goals — use refs to avoid dependency array issues
    const rp = routeProgressRef.current;
    if (rp?.active) {
      const rx = robotPose.x, ry = robotPose.y;
      let idx = rp.currentGoalIdx;
      const goals = rp.goals;
      while (idx < goals.length) {
        const gx = goals[idx].x, gy = goals[idx].y;
        const d = Math.sqrt((rx - gx) ** 2 + (ry - gy) ** 2);
        if (d < 3.0) idx++; else break;
      }
      if (idx !== rp.currentGoalIdx) {
        advanceGoalRef.current(idx, robotPose.speed ?? 0);
      }
    }
  }, [robotPose]);

  // Cleanup robot marker on unmount
  React.useEffect(() => {
    return () => { robotMarkerRef.current?.remove(); robotMarkerRef.current = null; };
  }, []);

  // ── Occupancy map ─────────────────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !occupancyMap) return;
    const { image, info } = occupancyMap;
    const bounds: [[number, number], [number, number]] = [
      [info.origin.x, info.origin.y],
      [info.origin.x + info.width * info.resolution, info.origin.y + info.height * info.resolution],
    ];
    if (!mapBoundsRef.current) mapBoundsRef.current = bounds;
    const url = image.toDataURL();
    const apply = () => {
      if (map.getSource("occ-map")) { map.removeLayer("occ-layer"); map.removeSource("occ-map"); }
      map.addSource("occ-map", { type: "image", url, coordinates: [[bounds[0][0], bounds[1][1]], [bounds[1][0], bounds[1][1]], [bounds[1][0], bounds[0][1]], [bounds[0][0], bounds[0][1]]] });
      map.addLayer({ id: "occ-layer", type: "raster", source: "occ-map" });
      map.fitBounds(bounds, { padding: 20 });
    };
    if (map.loaded()) apply(); else map.once("load", apply);
  }, [occupancyMap]);

  // ── Waypoint planning markers ─────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current.clear();

    waypoints.forEach((wp, index) => {
      const el = document.createElement("div");
      el.className = "wp-marker";
      el.style.cssText = `
        width:24px;height:24px;border-radius:50%;
        background:${MARKER_COLORS.planning};
        font-weight:bold;font-size:12px;font-family:monospace;
        display:flex;align-items:center;justify-content:center;
        color:white;
        box-shadow:0 1px 5px rgba(0,0,0,0.6);
        cursor:${mode === "off" ? "default" : "pointer"};user-select:none;
      `;
      el.textContent = String(index + 1);

      const marker = new maplibregl.Marker({ element: el, draggable: mode === "modify", anchor: "center" })
        .setLngLat([wp.x, wp.y]).addTo(map);

      if (mode === "modify") {
        marker.on("dragend", async () => {
          const pos = marker.getLngLat();
          const local = lngLatToLocal(pos.lng, pos.lat);
          const isValid = await validate(local.x, local.y);
          if (!isValid) { marker.setLngLat([wp.x, wp.y]); show("warning", "Outside lanelet", `Waypoint #${index + 1} snapped back`); }
          else update(wp.id, pos.lng, pos.lat);
        });
      }
      if (mode === "delete") {
        el.addEventListener("click", (e) => { e.stopPropagation(); remove(wp.id); });
      }
      wpMarkersRef.current.set(wp.id, marker);
    });

    return () => { wpMarkersRef.current.forEach((m) => m.remove()); wpMarkersRef.current.clear(); };
  }, [waypoints, mode, update, remove, validate, show]);

  React.useEffect(() => {
    wpMarkersRef.current.forEach((marker) => {
      marker.setDraggable(mode === "modify");
      marker.getElement().style.cursor = mode === "off" ? "default" : "pointer";
    });
  }, [mode]);

  // ── Map click → add waypoint ──────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      if (mode !== "modify") return;
      if ((e.originalEvent.target as HTMLElement).closest(".wp-marker")) return;
      const { lng, lat } = e.lngLat;
      const local = lngLatToLocal(lng, lat);
      const isValid = await validate(local.x, local.y);
      if (!isValid) {
        // Flash red X marker briefly
        const el = document.createElement("div");
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:#FF4444;color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,0.6);`;
        el.textContent = "✕";
        const m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
        setTimeout(() => m.remove(), 1200);
        show("warning", "Outside lanelet", "Waypoint not placed — outside drivable area");
        return;
      }
      add({ id: crypto.randomUUID(), x: lng, y: lat, yaw: 0 });
    };
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [mode, add, validate, show]);

  // ── Mission path ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const cleanup = () => {
      if (map.getLayer("path-line")) map.removeLayer("path-line");
      if (map.getSource("mission-path")) map.removeSource("mission-path");
    };
    if (!pathData || pathData.points.length === 0) { if (map.loaded()) cleanup(); return cleanup; }
    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: pathData.points.map((p) => [p.x, p.y]) },
    };
    const apply = () => {
      if (map.getSource("mission-path")) { (map.getSource("mission-path") as maplibregl.GeoJSONSource).setData(geojson); }
      else {
        map.addSource("mission-path", { type: "geojson", data: geojson });
        map.addLayer({ id: "path-line", type: "line", source: "mission-path", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#4a4e69", "line-width": 3, "line-opacity": 0.8 } });
      }
    };
    if (map.loaded()) apply(); else map.once("load", apply);
    return cleanup;
  }, [pathData]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", cursor: mode === "modify" ? "crosshair" : "default" }}
      />

      {mapLoading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(15,15,20,0.7)", backdropFilter: "blur(4px)", zIndex: 500, gap: 16 }}>
          <Spinner size={40} />
          <div style={{ color: "#adb5bd", fontSize: 14, fontWeight: 500 }}>Loading lanelet map…</div>
          <div style={{ color: "#6c757d", fontSize: 12 }}>GET /map</div>
        </div>
      )}

      <style>{`
        @keyframes mapspin { to { transform: rotate(360deg); } }
        @keyframes mppulse {
          0%   { box-shadow: 0 0 0 0 rgba(255,140,0,0.75); }
          70%  { box-shadow: 0 0 0 9px rgba(255,140,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,140,0,0); }
        }
      `}</style>
    </div>
  );
}

function Spinner({ size }: { size: number }) {
  return <div style={{ width: size, height: size, borderRadius: "50%", border: `${size > 20 ? 3 : 2}px solid rgba(102,126,234,0.2)`, borderTopColor: "#667eea", animation: "mapspin 0.9s linear infinite", flexShrink: 0 }} />;
}
