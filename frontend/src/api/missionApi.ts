import { http } from "./httpClient";
import { routePreview } from "./mapApi";
import {
  missionDefinitionFromRaw,
  missionDraftToRawPayload,
  missionExecutionStateFromRaw,
  missionSummaryFromRaw,
  type MissionDefinition,
  type MissionDraftInput,
  type MissionExecutionState,
  type MissionSummary,
  type RawMission,
  type RawMissionExecutionState,
  type RawMissionSummary,
  type RouteValidationResult,
  type Waypoint,
} from "../features/missions/missionTypes";
import { withLoopClosure } from "../features/missions/routeLoop";

export async function listMissionSummaries(): Promise<MissionSummary[]> {
  const raw = await http.get<RawMissionSummary[]>("/api/missions");
  return raw.map(missionSummaryFromRaw);
}

export async function getMission(missionId: string): Promise<MissionDefinition> {
  const raw = await http.get<RawMission>(`/api/missions/${encodeURIComponent(missionId)}`);
  return missionDefinitionFromRaw(raw);
}

export async function deleteMission(missionId: string): Promise<void> {
  await http.delete(`/api/missions/${encodeURIComponent(missionId)}`);
}

export async function activateMission(missionId: string): Promise<MissionDefinition> {
  const raw = await http.post<RawMission>(`/api/missions/${encodeURIComponent(missionId)}/activate`);
  return missionDefinitionFromRaw(raw);
}

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "mission";
}

function generateMissionId(name: string): string {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Creates or updates the mission and makes it the current one, in one request. */
export async function saveMission(draft: MissionDraftInput): Promise<MissionDefinition> {
  const missionId = draft.missionId ?? generateMissionId(draft.name);
  const payload = missionDraftToRawPayload({ ...draft, missionId, frameId: "map" });
  const raw = draft.missionId
    ? await http.put<RawMission>(`/api/missions/${encodeURIComponent(missionId)}?activate=true`, payload)
    : await http.post<RawMission>("/api/missions?activate=true", payload);
  return missionDefinitionFromRaw(raw);
}

export async function startMission(): Promise<MissionExecutionState> {
  const raw = await http.post<RawMissionExecutionState>("/api/missions/current/start");
  return missionExecutionStateFromRaw(raw);
}

export async function pauseMission(): Promise<MissionExecutionState> {
  const raw = await http.post<RawMissionExecutionState>("/api/missions/current/pause");
  return missionExecutionStateFromRaw(raw);
}

export async function resumeMission(): Promise<MissionExecutionState> {
  const raw = await http.post<RawMissionExecutionState>("/api/missions/current/resume");
  return missionExecutionStateFromRaw(raw);
}

export async function stopMission(): Promise<MissionExecutionState> {
  const raw = await http.post<RawMissionExecutionState>("/api/missions/current/stop");
  return missionExecutionStateFromRaw(raw);
}

export async function validateRoute(waypoints: Waypoint[]): Promise<RouteValidationResult> {
  try {
    const result = await routePreview(
      withLoopClosure(waypoints).map((wp) => ({ x: wp.x, y: wp.y, yaw: wp.yaw ?? undefined })),
    );
    if (result.ok && result.route) {
      return { valid: true, route: result.route, errors: [] };
    }
    return {
      valid: false,
      route: null,
      errors: [
        { code: "route_unreachable", message: "No route could be computed between the given waypoints." },
      ],
    };
  } catch (err) {
    return {
      valid: false,
      route: null,
      errors: [
        {
          code: "validation_failed",
          message: err instanceof Error ? err.message : "Route validation failed.",
        },
      ],
    };
  }
}
