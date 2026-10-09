import { http } from "./httpClient";

export interface MapInfo {
  mapName: string;
  frameId: string;
  originLat: number;
  originLon: number;
  laneletCount: number;
}

export interface MapPoint {
  x: number;
  y: number;
  frameId: string;
  laneletId: number | null;
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

export interface XY {
  x: number;
  y: number;
  frameId: string;
}

export interface RoutePreviewResult {
  ok: boolean;
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
}

interface RawMapInfo {
  map_name: string;
  frame_id: string;
  origin_lat: number;
  origin_lon: number;
  lanelet_count: number;
}

interface RawMapPoint {
  x: number;
  y: number;
  frame_id: string;
  lanelet_id: number | null;
}

interface RawXY {
  x: number;
  y: number;
  frame_id: string;
}

export async function getMapInfo(): Promise<MapInfo> {
  const raw = await http.get<RawMapInfo>("/api/map/info");
  return {
    mapName: raw.map_name,
    frameId: raw.frame_id,
    originLat: raw.origin_lat,
    originLon: raw.origin_lon,
    laneletCount: raw.lanelet_count,
  };
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

export async function isInLanelet(x: number, y: number, frameId = "map"): Promise<boolean> {
  const raw = await http.post<{ in_lanelet: boolean }>("/api/map/is-in-lanelet", {
    x,
    y,
    frame_id: frameId,
  });
  return raw.in_lanelet;
}

export async function snapWaypoint(x: number, y: number, frameId = "map"): Promise<MapPoint> {
  const raw = await http.post<RawMapPoint>("/api/map/snap-waypoint", { x, y, frame_id: frameId });
  return { x: raw.x, y: raw.y, frameId: raw.frame_id, laneletId: raw.lanelet_id };
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

export async function lngLatToXy(lat: number, lon: number, frameId = "map"): Promise<XY> {
  const raw = await http.post<RawXY>("/api/map/lnglat-to-xy", { lat, lon, frame_id: frameId });
  return { x: raw.x, y: raw.y, frameId: raw.frame_id };
}
