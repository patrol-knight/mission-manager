import type { components } from "./schema";
import { http } from "./httpClient";

export interface PlacedPoint {
  x: number;
  y: number;
  lat: number | null;
  lon: number | null;
}

export interface RouteWaypoint {
  x: number;
  y: number;
  yaw?: number | null;
  frameId?: string;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RoutePreviewResult {
  ok: boolean;
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
}

type RawMapPoint = components["schemas"]["MapPoint"];
export type HeatmapView = components["schemas"]["HeatmapView"];


export function getHeatmap(): Promise<HeatmapView> {
  return http.get<HeatmapView>("/api/map/heatmap");
}

export function getLaneletGeojson(): Promise<GeoJSON.FeatureCollection> {
  return http.get<GeoJSON.FeatureCollection>("/api/map/geojson");
}

/** Named fields (not a [lat,lng] tuple) so callers can't accidentally hand this
 * to a MapLibre API expecting [lng,lat] order — see backend/core/map_server.py's
 * `_compute_bounds`, which returns [[south,west],[north,east]] i.e. [lat,lon]. */
export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export async function getMapBounds(): Promise<MapBounds> {
  const raw = await http.get<{ bounds: [[number, number], [number, number]] }>("/api/map/bounds");
  const [[south, west], [north, east]] = raw.bounds;
  return { south, west, north, east };
}

/** A clicked point snapped onto its lanelet; null when it's off the road. */
export async function placeWaypoint(lat: number, lon: number, frameId = "map"): Promise<PlacedPoint | null> {
  const raw = await http.post<RawMapPoint | null>("/api/map/place-waypoint", { lat, lon, frame_id: frameId });
  return raw && { x: raw.x, y: raw.y, lat: raw.lat, lon: raw.lon };
}

export function routePreview(waypoints: RouteWaypoint[]): Promise<RoutePreviewResult> {
  return http.post<RoutePreviewResult>("/api/map/route-preview", {
    waypoints: waypoints.map((wp) => ({
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw ?? null,
      frame_id: wp.frameId ?? "map",
    })),
  });
}

export async function xyToLngLat(x: number, y: number, frameId = "map"): Promise<LatLon> {
  return http.post<LatLon>("/api/map/xy-to-lnglat", { x, y, frame_id: frameId });
}
