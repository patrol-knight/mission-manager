export type WaypointType = "patrol" | "inspection" | "charging" | "custom";

export interface Waypoint {
  waypointId: string;
  x: number;
  y: number;
  yaw: number | null;
  label: string | null;
  type: WaypointType;
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
  description: string | null;
  waypoints: Waypoint[];
  loopCount: number;
  /** Loop until cancelled; loopCount is kept but unused while this is set. */
  infiniteLoop: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

/** "not_ready": idle, but the robot can't run a mission (offline). */
export type MissionStatus = "not_ready" | "ready" | "running" | "paused" | "completed";

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
  updatedAt: string | null;
}

export interface RawMissionExecutionState {
  mission_id: string;
  status: MissionStatus;
  current_loop: number;
  completed_loops: number;
  current_waypoint_index: number;
  target_waypoint_index: number | null;
  joining: boolean;
  updated_at: string | null;
}

export function missionExecutionStateFromRaw(raw: RawMissionExecutionState): MissionExecutionState {
  return {
    missionId: raw.mission_id,
    status: raw.status,
    currentLoop: raw.current_loop,
    completedLoops: raw.completed_loops,
    currentWaypointIndex: raw.current_waypoint_index,
    targetWaypointIndex: raw.target_waypoint_index,
    joining: raw.joining,
    updatedAt: raw.updated_at,
  };
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

// ---- wire shapes (snake_case, backend/models/mission.py & waypoint.py) + adapter ----

interface RawWaypoint {
  waypoint_id: string;
  x: number;
  y: number;
  yaw: number | null;
  label: string | null;
  type: WaypointType;
  lat?: number | null;
  lon?: number | null;
}

export interface RawMission {
  mission_id: string;
  name: string;
  map_name: string;
  frame_id: string;
  description: string | null;
  waypoints: RawWaypoint[];
  loop_count: number;
  infinite_loop: boolean;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown>;
}

export function missionDefinitionFromRaw(raw: RawMission): MissionDefinition {
  return {
    missionId: raw.mission_id,
    name: raw.name,
    mapName: raw.map_name,
    frameId: raw.frame_id,
    description: raw.description,
    waypoints: raw.waypoints.map((wp) => ({
      waypointId: wp.waypoint_id,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      label: wp.label,
      type: wp.type,
      lat: wp.lat,
      lon: wp.lon,
    })),
    loopCount: raw.loop_count,
    infiniteLoop: raw.infinite_loop,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    metadata: raw.metadata,
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
  isCurrent: boolean;
  updatedAt: string | null;
}

export interface RawMissionSummary {
  mission_id: string;
  name: string;
  map_name: string;
  frame_id: string;
  waypoint_count: number;
  loop_count: number;
  infinite_loop: boolean;
  home_x: number | null;
  home_y: number | null;
  distance_m: number | null;
  is_current: boolean;
  updated_at: string | null;
}

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
export function missionDraftToRawPayload(draft: ResolvedMissionDraft): Omit<RawMission, "map_name"> {
  return {
    mission_id: draft.missionId,
    name: draft.name.trim(),
    frame_id: draft.frameId,
    description: null,
    waypoints: draft.waypoints.map((wp) => ({
      waypoint_id: wp.waypointId,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      label: wp.label,
      type: wp.type,
    })),
    loop_count: draft.loopCount,
    infinite_loop: draft.infiniteLoop,
    created_at: null,
    updated_at: null,
    metadata: {},
  };
}
