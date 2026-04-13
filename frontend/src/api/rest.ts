import { API_BASE_URL } from "./config";
import type {
  ValidateRequest,
  ValidateResponse,
  Waypoint,
  RobotPose,
  RouteWaypoint,
  RouteResponse,
} from "../types";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchLaneletMap(): Promise<GeoJSON.FeatureCollection> {
  return apiFetch<GeoJSON.FeatureCollection>("/map");
}

export async function fetchMapOrigin(): Promise<{ lat: number; lon: number }> {
  return apiFetch<{ lat: number; lon: number }>("/map/origin");
}

export async function fetchMapBounds(): Promise<{
  bounds: [[number, number], [number, number]];
}> {
  return apiFetch<{ bounds: [[number, number], [number, number]] }>("/map/bounds");
}

export async function validateWaypoint(req: ValidateRequest): Promise<ValidateResponse> {
  return apiFetch<ValidateResponse>("/map/validate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function fetchRoute(waypoints: RouteWaypoint[]): Promise<RouteResponse> {
  return apiFetch<RouteResponse>("/map/route", {
    method: "POST",
    body: JSON.stringify({ waypoints }),
  });
}

export async function publishWaypoints(waypoints: RouteWaypoint[]): Promise<void> {
  await apiFetch("/map/waypoints/publish", {
    method: "POST",
    body: JSON.stringify({
      waypoints: waypoints.map((wp) => ({ x: wp.x, y: wp.y, yaw: 0.0 })),
    }),
  });
}

export async function publishMission(waypoints: Waypoint[]): Promise<void> {
  await apiFetch("/mission/publish", {
    method: "POST",
    body: JSON.stringify({
      waypoints: waypoints.map((wp) => ({ x: wp.x, y: wp.y, yaw: wp.yaw })),
    }),
  });
}

export async function publishInitialPose(x: number, y: number, yaw: number): Promise<void> {
  await apiFetch("/robot/initial_pose", {
    method: "POST",
    body: JSON.stringify({ x, y, yaw }),
  });
}

export async function fetchRobotPose(): Promise<RobotPose> {
  return apiFetch<RobotPose>("/robot/pose");
}

export async function projectToXY(lng: number, lat: number): Promise<{ x: number; y: number }> {
  return apiFetch<{ x: number; y: number }>("/map/project/to_xy", {
    method: "POST",
    body: JSON.stringify({ lng, lat }),
  });
}

export async function projectToLngLat(x: number, y: number): Promise<{ lng: number; lat: number }> {
  return apiFetch<{ lng: number; lat: number }>("/map/project/to_lnglat", {
    method: "POST",
    body: JSON.stringify({ x, y }),
  });
}
