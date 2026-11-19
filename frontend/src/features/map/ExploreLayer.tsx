import { useContext, useEffect, useMemo } from "react";
import * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useGeoJsonLineLayer } from "./useGeoJsonLineLayer";
import { mapPalette, routeLineWidth } from "./mapPalette";
import { remainingRoute } from "./geo";
import { useInvestigationStore, type PickedPoint } from "../../stores/investigationStore";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { previewExplore } from "../../api/investigationApi";
import type { InvestigationTarget } from "../investigation/investigationTypes";

/** The route the robot would take: the investigation route's yellow, half
 * strength until Investigate makes it the real one. */
const PREVIEW_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.investigation,
  "line-width": routeLineWidth,
  "line-opacity": 0.5,
};

/** Stop -> point: "the robot stops here to look there". */
const SIGHT_PAINT: maplibregl.LineLayerSpecification["paint"] = {
  "line-color": mapPalette.investigation,
  "line-width": 2,
  "line-opacity": 0.9,
  "line-dasharray": [0.1, 2],
};

/** Re-preview once the robot has driven this far from where it was previewed. */
const REPREVIEW_AFTER_M = 5;

interface PointMarker {
  key: "picked" | "picked-stop" | "exploring";
  lat: number;
  lon: number;
}

/** A hollow yellow ring: the point to explore. */
function buildPointElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:24px;height:24px;border-radius:50%;box-sizing:border-box;
    border:4px solid ${mapPalette.investigation};
    box-shadow:0 0 0 2px ${mapPalette.markerBorder}, inset 0 0 0 2px ${mapPalette.markerBorder}, ${mapPalette.markerShadow};
    pointer-events:none;
    z-index:4;
  `;
  return el;
}

/** A small yellow dot: where the robot would stop, before it's sent (after,
 * InvestigationTargetLayer draws it). */
function buildStopElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:12px;height:12px;border-radius:50%;
    background:${mapPalette.investigation};
    border:2px solid ${mapPalette.markerBorder};
    box-shadow:${mapPalette.markerShadow};
    pointer-events:none;
    z-index:3;
  `;
  return el;
}

function markerAt(key: PointMarker["key"], target: InvestigationTarget | null): PointMarker | null {
  return target?.lat != null && target.lon != null ? { key, lat: target.lat, lon: target.lon } : null;
}

function sightLine(from: InvestigationTarget, to: InvestigationTarget): GeoJSON.Feature<GeoJSON.LineString> | null {
  if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [[from.lon, from.lat], [to.lon, to.lat]] },
  };
}

/** Metres between two lon/lat points (flat earth: fine for a site). */
function metresBetween(a: [number, number], b: [number, number]): number {
  const k = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_320;
}

// The latest preview request wins; and where the robot was when it was asked.
let latestRequest = 0;
let previewedFrom: [number, number] | null = null;

/** Previews `point` from where the robot is now; `keep` stays shown meanwhile. */
function requestPreview(point: Pick<PickedPoint, "lat" | "lon">, keep: PickedPoint["preview"]): void {
  const id = ++latestRequest;
  const pose = selectRobot(useDeviceStore.getState())?.pose;
  previewedFrom = pose?.lon != null && pose.lat != null ? [pose.lon, pose.lat] : null;
  const { setPicked } = useInvestigationStore.getState();
  setPicked({ ...point, preview: keep, error: null });
  previewExplore(point.lat, point.lon).then(
    (result) => {
      if (id === latestRequest) setPicked({ ...point, preview: result, error: null });
    },
    (err: unknown) => {
      if (id !== latestRequest) return;
      setPicked({ ...point, preview: null, error: err instanceof Error ? err.message : "Can't reach this point" });
    },
  );
}

/** Explore on the map, previewed like a navigation app. While picking, a
 * click picks the point (another click moves it): its ring, the stop, a
 * dotted sight line between them, and the route there at half strength,
 * trimmed to what lies ahead of the robot, while the mission steps back
 * (see selectPreviewing). The view eases out to show it all if it doesn't.
 * Once sent, the investigation layers draw the real route and stop; the
 * ring and the sight line stay until Explore ends. */
export function ExploreLayer() {
  const { map } = useContext(MapContext);
  const picking = useInvestigationStore((s) => s.picking);
  const picked = useInvestigationStore((s) => s.picked);
  const exploring = useInvestigationStore((s) => (s.investigation?.kind === "manual" ? s.investigation : null));
  const robotLon = useDeviceStore((s) => selectRobot(s)?.pose?.lon ?? null);
  const robotLat = useDeviceStore((s) => selectRobot(s)?.pose?.lat ?? null);
  const robot = useMemo<[number, number] | null>(
    () => (robotLon !== null && robotLat !== null ? [robotLon, robotLat] : null),
    [robotLon, robotLat],
  );

  useEffect(() => {
    if (!map || !picking) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    const onClick = (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as HTMLElement).closest(".maplibregl-marker")) return;
      requestPreview({ lat: e.lngLat.lat, lon: e.lngLat.lng }, null);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
      canvas.style.cursor = "";
      latestRequest++; // drop any preview still on its way
    };
  }, [map, picking]);

  // The robot drives on (a running mission) while the point is previewed:
  // ask again from where it is now, keeping the old preview meanwhile.
  useEffect(() => {
    if (!picked?.preview || !robot || !previewedFrom) return;
    if (metresBetween(robot, previewedFrom) < REPREVIEW_AFTER_M) return;
    requestPreview({ lat: picked.lat, lon: picked.lon }, picked.preview);
  }, [robot, picked]);

  // A new preview that runs off the screen: ease out to show it (never in).
  const shown = picked?.preview ?? null;
  useEffect(() => {
    if (!map || !shown) return;
    const coords = shown.route.geometry.coordinates as [number, number][];
    const points = [...coords];
    if (shown.lookAt.lon != null && shown.lookAt.lat != null) points.push([shown.lookAt.lon, shown.lookAt.lat]);
    if (points.length === 0) return;
    const view = map.getBounds();
    if (points.every((p) => view.contains(p))) return;
    const bounds = new maplibregl.LngLatBounds();
    points.forEach((p) => bounds.extend(p));
    map.fitBounds(bounds, { padding: 80, maxZoom: map.getZoom(), duration: 600 });
  }, [map, shown]);

  const previewRoute = useMemo<GeoJSON.Feature<GeoJSON.LineString> | null>(() => {
    if (!shown) return null;
    if (!robot) return shown.route;
    const coords = shown.route.geometry.coordinates as [number, number][];
    return { ...shown.route, geometry: { ...shown.route.geometry, coordinates: remainingRoute(coords, robot) } };
  }, [shown, robot]);
  useGeoJsonLineLayer(map, "explore-preview", "explore-preview-line", previewRoute, PREVIEW_PAINT, true);

  // The sight line of the point being previewed, else of the one being explored.
  const sight = useMemo(
    () => (shown ? sightLine(shown.target, shown.lookAt) : exploring ? sightLine(exploring.target, exploring.lookAt) : null),
    [shown, exploring],
  );
  useGeoJsonLineLayer(map, "explore-sight", "explore-sight-line", sight, SIGHT_PAINT, true);

  const markers = useMemo<PointMarker[]>(() => {
    const list = [markerAt("exploring", exploring?.lookAt ?? null)];
    if (picked) {
      list.push({ key: "picked", lat: picked.lat, lon: picked.lon });
      list.push(markerAt("picked-stop", picked.preview?.target ?? null));
    }
    return list.filter((m): m is PointMarker => m !== null);
  }, [picked, exploring]);

  const options = useMemo<UseMarkerListOptions<PointMarker>>(
    () => ({
      keyOf: (m) => m.key,
      dependsOn: (m) => [m.lat, m.lon],
      project: async (m) => ({ lng: m.lon, lat: m.lat }),
      buildElement: (m) => (m.key === "picked-stop" ? buildStopElement() : buildPointElement()),
    }),
    [],
  );
  useMarkerList(map, markers, options);
  return null;
}
