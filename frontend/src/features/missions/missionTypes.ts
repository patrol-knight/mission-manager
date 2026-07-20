export type WaypointType = "patrol" | "inspection" | "charging" | "custom";

export interface Waypoint {
  waypointId: string;
  x: number;
  y: number;
  yaw: number | null;
  label: string | null;
  type: WaypointType;
}

export interface TimeSlot {
  start: string | null;
  end: string | null;
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
  timeSlot: TimeSlot | null;
  waypoints: Waypoint[];
  loopCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

export type MissionStatus = "ready" | "running" | "paused" | "returning_home" | "completed";

/** Runtime execution progress — see backend/models/mission_execution.py::MissionExecutionState. */
export interface MissionExecutionState {
  missionId: string;
  status: MissionStatus;
  currentLoop: number;
  completedLoops: number;
  currentWaypointIndex: number;
  updatedAt: string | null;
}

export interface RawMissionExecutionState {
  mission_id: string;
  status: MissionStatus;
  current_loop: number;
  completed_loops: number;
  current_waypoint_index: number;
  updated_at: string | null;
}

export function missionExecutionStateFromRaw(raw: RawMissionExecutionState): MissionExecutionState {
  return {
    missionId: raw.mission_id,
    status: raw.status,
    currentLoop: raw.current_loop,
    completedLoops: raw.completed_loops,
    currentWaypointIndex: raw.current_waypoint_index,
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
}

interface RawTimeSlot {
  start: string | null;
  end: string | null;
}

export interface RawMission {
  mission_id: string;
  name: string;
  map_name: string;
  frame_id: string;
  description: string | null;
  time_slot: RawTimeSlot | null;
  waypoints: RawWaypoint[];
  /** Absent until backend milestone B2 lands; defaults to 1. */
  loop_count?: number;
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
    timeSlot: raw.time_slot ? { start: raw.time_slot.start, end: raw.time_slot.end } : null,
    waypoints: raw.waypoints.map((wp) => ({
      waypointId: wp.waypoint_id,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      label: wp.label,
      type: wp.type,
    })),
    loopCount: raw.loop_count ?? 1,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    metadata: raw.metadata,
  };
}

/** Lightweight entry for the mission picker — see backend/models/mission.py::MissionSummary. */
export interface MissionSummary {
  missionId: string;
  name: string;
  mapName: string;
  frameId: string;
  waypointCount: number;
  timeSlot: TimeSlot | null;
  isCurrent: boolean;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface RawMissionSummary {
  mission_id: string;
  name: string;
  map_name: string;
  frame_id: string;
  waypoint_count: number;
  time_slot: RawTimeSlot | null;
  is_current: boolean;
  is_default: boolean;
  updated_at: string | null;
}

export function missionSummaryFromRaw(raw: RawMissionSummary): MissionSummary {
  return {
    missionId: raw.mission_id,
    name: raw.name,
    mapName: raw.map_name,
    frameId: raw.frame_id,
    waypointCount: raw.waypoint_count,
    timeSlot: raw.time_slot ? { start: raw.time_slot.start, end: raw.time_slot.end } : null,
    isCurrent: raw.is_current,
    isDefault: raw.is_default,
    updatedAt: raw.updated_at,
  };
}

export interface MissionDraftInput {
  /** null for a brand-new mission (missionApi generates an id); set when editing an existing one. */
  missionId: string | null;
  name: string;
  loopCount: number;
  waypoints: Waypoint[];
}

interface ResolvedMissionDraft extends Omit<MissionDraftInput, "missionId"> {
  missionId: string;
  mapName: string;
  frameId: string;
}

export function missionDraftToRawPayload(draft: ResolvedMissionDraft): RawMission {
  return {
    mission_id: draft.missionId,
    name: draft.name.trim(),
    map_name: draft.mapName,
    frame_id: draft.frameId,
    description: null,
    time_slot: null,
    waypoints: draft.waypoints.map((wp) => ({
      waypoint_id: wp.waypointId,
      x: wp.x,
      y: wp.y,
      yaw: wp.yaw,
      label: wp.label,
      type: wp.type,
    })),
    loop_count: draft.loopCount,
    created_at: null,
    updated_at: null,
    metadata: {},
  };
}
