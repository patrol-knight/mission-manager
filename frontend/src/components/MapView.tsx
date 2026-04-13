import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useWaypointStore } from "../stores/waypointStore";
import { useRobotPose } from "../hooks/useRobotPose";
import { useLaneletMap } from "../hooks/useMapData";
import { useWaypointValidation } from "../hooks/useWaypointValidation";
import { fetchMapBounds, projectToXY, projectToLngLat } from "../api/rest";
import { useApiConnection } from "../hooks/useApiConnection";
import { useToast } from "./Toast";

const MARKER_COLORS = {
  planning: "#4dabf7",
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
  if (pulse) el.style.animation = "mppulse 1.2s infinite";
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
  const prevBearingRef = React.useRef<number | null>(null);

  const add = useWaypointStore((s) => s.add);
  const update = useWaypointStore((s) => s.update);
  const remove = useWaypointStore((s) => s.remove);
  const waypoints = useWaypointStore((s) => s.waypoints);
  const mode = useWaypointStore((s) => s.mode);
  const routeProgress = useWaypointStore((s) => s.routeProgress);
  const advanceGoal = useWaypointStore((s) => s.advanceGoal);

  const robotPose = useRobotPose();
  const { geojson: laneletGeojson } = useLaneletMap();
  const { validate } = useWaypointValidation();
  const { status } = useApiConnection();
  const { show } = useToast();

  const [mapLoading, setMapLoading] = React.useState(true);

  React.useEffect(() => {
    if (status === "disconnected") setMapLoading(true);
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

  React.useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors", maxzoom: 19 } },
        layers: [{ id: "osm-tiles", type: "raster", source: "osm", minzoom: 0, maxzoom: 22 }],
      },
      center: [121.5, 25.0],
      zoom: 17,
      maxZoom: 22,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    map.on("load", async () => {
      try {
        const boundsData = await fetchMapBounds();
        mapBoundsRef.current = boundsData.bounds;
        map.fitBounds(boundsData.bounds, { padding: 60, duration: 0 });
      } catch (e) {
        console.warn("Could not fetch map bounds:", e);
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

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    routeMarkersRef.current.forEach((m) => m.remove());
    routeMarkersRef.current = [];

    if (!routeProgress) return;

    Promise.all(
      routeProgress.goals.map((goal) => projectToLngLat(goal.x, goal.y))
    ).then((lngLats) => {
      lngLats.forEach(({ lng, lat }, i) => {
        const goal = routeProgress.goals[i];
        const color = MARKER_COLORS[goal.state];
        const el = makeMarkerEl(i + 1, color, goal.state === "current");
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
        routeMarkersRef.current.push(marker);
      });
    }).catch((e) => console.warn("Route marker projection failed:", e));
  }, [routeProgress]);

  const routeProgressRef = React.useRef(routeProgress);
  routeProgressRef.current = routeProgress;
  const advanceGoalRef = React.useRef(advanceGoal);
  advanceGoalRef.current = advanceGoal;

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !robotPose) return;

    if (robotPose.lat === undefined || robotPose.lon === undefined) {
      console.warn("[MapView] robotPose missing lat/lon — backend must include them in robot_pose WS payload");
      return;
    }

    const lng = robotPose.lon;
    const lat = robotPose.lat;
    const rawBearing = 90 - robotPose.yaw * (180 / Math.PI);
    let bearing = rawBearing;
    if (prevBearingRef.current !== null) {
      let delta = rawBearing - prevBearingRef.current;
      if (delta > 180)  delta -= 360;
      if (delta < -180) delta += 360;
      bearing = prevBearingRef.current + delta;
    }
    prevBearingRef.current = bearing;

    if (robotMarkerRef.current) {
      robotMarkerRef.current.setLngLat([lng, lat]);
      const svg = robotMarkerRef.current.getElement().querySelector("svg");
      if (svg) svg.style.transform = `rotate(${bearing}deg)`;
    } else {
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

    const rp = routeProgressRef.current;
    if (rp?.active) {
      let idx = rp.currentGoalIdx;
      while (idx < rp.goals.length) {
        const dx = rp.goals[idx].x - robotPose.x;
        const dy = rp.goals[idx].y - robotPose.y;
        const d = Math.sqrt(dx ** 2 + dy ** 2);

        // const vx = Math.cos(robotPose.yaw);
        // const vy = Math.sin(robotPose.yaw);
        // const dot = vx * dx + vy * dy;
        if (d < 0.5) idx++; else break;
      }
      if (idx !== rp.currentGoalIdx) advanceGoalRef.current(idx, robotPose.speed ?? 0);
    }
  }, [robotPose]);

  React.useEffect(() => {
    return () => { robotMarkerRef.current?.remove(); robotMarkerRef.current = null; };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    wpMarkersRef.current.forEach((m) => m.remove());
    wpMarkersRef.current.clear();

    Promise.all(
      waypoints.map((wp) => projectToLngLat(wp.x, wp.y).then(({ lng, lat }) => ({ wp, lng, lat })))
    ).then((resolved) => {
      resolved.forEach(({ wp, lng, lat }, index) => {
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
          .setLngLat([lng, lat])
          .addTo(map);

        if (mode === "modify") {
          marker.on("dragend", async () => {
            const pos = marker.getLngLat();
            const local = await projectToXY(pos.lng, pos.lat);
            const isValid = await validate(local.x, local.y);
            if (!isValid) {
              const orig = await projectToLngLat(wp.x, wp.y);
              marker.setLngLat([orig.lng, orig.lat]);
              show("warning", "Outside lanelet", `Waypoint #${index + 1} snapped back`);
            } else {
              update(wp.id, local.x, local.y);
            }
          });
        }
        if (mode === "delete") {
          el.addEventListener("click", (e) => { e.stopPropagation(); remove(wp.id); });
        }
        wpMarkersRef.current.set(wp.id, marker);
      });
    }).catch((e) => console.warn("Waypoint marker projection failed:", e));

    return () => { wpMarkersRef.current.forEach((m) => m.remove()); wpMarkersRef.current.clear(); };
  }, [waypoints, mode, update, remove, validate, show]);

  React.useEffect(() => {
    wpMarkersRef.current.forEach((marker) => {
      marker.setDraggable(mode === "modify");
      marker.getElement().style.cursor = mode === "off" ? "default" : "pointer";
    });
  }, [mode]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      if (mode !== "modify") return;
      if ((e.originalEvent.target as HTMLElement).closest(".wp-marker")) return;
      const { lng, lat } = e.lngLat;
      const local = await projectToXY(lng, lat);
      const isValid = await validate(local.x, local.y);
      if (!isValid) {
        const el = document.createElement("div");
        el.style.cssText = `width:24px;height:24px;border-radius:50%;background:#FF4444;color:#fff;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,0.6);`;
        el.textContent = "✕";
        const m = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
        setTimeout(() => m.remove(), 1200);
        show("warning", "Outside lanelet", "Waypoint not placed — outside drivable area");
        return;
      }
      add({ id: crypto.randomUUID(), x: local.x, y: local.y, yaw: 0 });
    };
    map.on("click", handleClick);
    return () => { map.off("click", handleClick); };
  }, [mode, add, validate, show]);

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
