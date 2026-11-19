import type { components } from "../../api/schema";

type Schemas = components["schemas"];


export interface Waypoint {
  waypointId: string;
  x: number;
  y: number;
  /** Goal heading; null = along the lane (the backend fills it in). */
  yaw: number | null;
  /** Seconds the robot holds here before heading on; 0 = none. */
  dwellSec: number;
  /** From the backend (never saved back); null when the map was unavailable. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * The mission's authored configuration (name/waypoints/loop count) — distinct from
 * MissionExecutionState, which is runtime progress. The two are never merged into one
 * type: "mission definition" vs "mission execution" throughout this codebase.
 */
export interface MissionDefinition {
  missionId: string;
  name: string;
  mapName: string;
  frameId: string;
  waypoints: Waypoint[];
  loopCount: number;
  /** Loop until cancelled; loopCount is kept but unused while this is set. */
  infiniteLoop: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** "not_ready": idle, but the robot can't run a mission (offline). */
export type MissionStatus = Schemas["MissionStatus"];

/** Runtime execution progress — see backend/models/mission_execution.py::MissionExecutionState. */
export interface MissionExecutionState {
  missionId: string;
  status: MissionStatus;
  currentLoop: number;
  completedLoops: number;
  /** The last waypoint reached. */
  currentWaypointIndex: number;
  /** Set while running or paused. */
  targetWaypointIndex: number | null;
  /** Heading to where the robot joins the route (Start, or after an investigation). */
  joining: boolean;
  /** Holding at currentWaypointIndex: its full dwell, null when not holding. */
  dwellSec: number | null;
  /** Seconds of the dwell left as of `receivedAt` (frozen while paused). */
  dwellRemainingSec: number | null;
  /** When this state arrived (browser clock): the dwell counts down from here. */
  receivedAt: number;
  updatedAt: string | null;
}

export type RawMissionExecutionState = Schemas["MissionExecutionState"];

export function missionExecutionStateFromRaw(raw: RawMissionExecutionState): MissionExecutionState {
  return {
    missionId: raw.mission_id,
    status: raw.status,
    currentLoop: raw.current_loop,
    completedLoops: raw.completed_loops,
    currentWaypointIndex: raw.current_waypoint_index,
    targetWaypointIndex: raw.target_waypoint_index,
    joining: raw.joining,
    dwellSec: raw.dwell_sec ?? null,
    dwellRemainingSec: raw.dwell_remaining_sec ?? null,
    receivedAt: Date.now(),
    updatedAt: raw.updated_at,
  };
}

/** Seconds left of the current dwell at `now`; null when not dwelling. */
export function dwellLeft(execution: MissionExecutionState | null, now: number): number | null {
  if (!execution || execution.dwellSec === null || execution.dwellRemainingSec === null) return null;
  if (execution.status !== "running") return execution.dwellRemainingSec;
  return Math.max(0, execution.dwellRemainingSec - (now - execution.receivedAt) / 1000);
}

export interface ValidationIssue {
  code: string;
  message: string;
  waypointId?: string;
}

export interface RouteValidationResult {
  valid: boolean;
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
  errors: ValidationIssue[];
  warnings?: ValidationIssue[];
}

// ---- wire shapes (generated from the backend, see api/schema.ts) + adapter ----

export type RawMission = Schemas["MissionGeo"];

export function missionDefinitionFromRaw(raw: RawMission): MissionDefinition {
  return {
    missionId: raw.mission_id,
    name: raw.name,
    mapName: raw.map_name,
    frameId: raw.frame_id,
    waypoints: raw.waypoints.map((wp) => ({
      waypointId: wp.waypoint_id,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      dwellSec: wp.dwell_sec ?? 0,
      lat: wp.lat,
      lon: wp.lon,
    })),
    loopCount: raw.loop_count,
    infiniteLoop: raw.infinite_loop,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Lightweight entry for the mission library — see backend/models/mission.py::MissionSummary. */
export interface MissionSummary {
  missionId: string;
  name: string;
  mapName: string;
  frameId: string;
  waypointCount: number;
  loopCount: number;
  infiniteLoop: boolean;
  homeX: number | null;
  homeY: number | null;
  /** Loop-closed, lanelet-routed path length in meters; null if unroutable or <2 waypoints. */
  distanceM: number | null;
  /** Seconds of dwell per loop. */
  dwellSec: number;
  /** Estimated seconds for one loop (driving, a stop per waypoint, dwells); null without a route. */
  loopSec: number | null;
  isCurrent: boolean;
  updatedAt: string | null;
}

export type RawMissionSummary = Schemas["MissionSummary"];

export function missionSummaryFromRaw(raw: RawMissionSummary): MissionSummary {
  return {
    missionId: raw.mission_id,
    name: raw.name,
    mapName: raw.map_name,
    frameId: raw.frame_id,
    waypointCount: raw.waypoint_count,
    loopCount: raw.loop_count,
    infiniteLoop: raw.infinite_loop,
    homeX: raw.home_x,
    homeY: raw.home_y,
    distanceM: raw.distance_m,
    dwellSec: raw.dwell_sec ?? 0,
    loopSec: raw.loop_sec ?? null,
    isCurrent: raw.is_current,
    updatedAt: raw.updated_at,
  };
}

export interface MissionDraftInput {
  /** null for a brand-new mission (missionApi generates an id); set when editing an existing one. */
  missionId: string | null;
  name: string;
  loopCount: number;
  infiniteLoop: boolean;
  waypoints: Waypoint[];
}

interface ResolvedMissionDraft extends Omit<MissionDraftInput, "missionId"> {
  missionId: string;
  frameId: string;
}

/** The backend fills in map_name from the loaded map. */
export function missionDraftToRawPayload(draft: ResolvedMissionDraft): Schemas["Mission"] {
  return {
    mission_id: draft.missionId,
    name: draft.name.trim(),
    frame_id: draft.frameId,
    waypoints: draft.waypoints.map((wp) => ({
      waypoint_id: wp.waypointId,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      dwell_sec: wp.dwellSec,
    })),
    loop_count: draft.loopCount,
    infinite_loop: draft.infiniteLoop,
    created_at: null,
    updated_at: null,
  };
}
