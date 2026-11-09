import type { GeofenceSet } from "./geofenceApi";

export const MIN_ZONE_POINTS = 3;

export interface GeofencePoint {
  id: string;
  lat: number;
  lng: number;
}

export interface GeofenceZone {
  zoneId: string;
  points: GeofencePoint[];
}

/** `draft` is the copy being edited, null outside edit mode: `saved` only
 * changes when the backend confirms it. */
export interface GeofenceEditorState {
  saved: GeofenceZone[];
  draft: GeofenceZone[] | null;
  selectedZoneId: string | null;
  selectedPointId: string | null;
  nextPointId: number;
}

export const INITIAL_STATE: GeofenceEditorState = {
  saved: [],
  draft: null,
  selectedZoneId: null,
  selectedPointId: null,
  nextPointId: 1,
};

export type GeofenceEditorAction =
  | { type: "LOADED"; zones: GeofenceSet["zones"] }
  | { type: "BEGIN_EDIT" }
  | { type: "CANCEL_EDIT" }
  | { type: "ADD_ZONE" }
  | { type: "DELETE_ZONE"; zoneId: string }
  | { type: "SELECT_ZONE"; zoneId: string }
  | { type: "ADD_POINT"; lat: number; lng: number }
  | { type: "INSERT_POINT"; afterId: string; lat: number; lng: number }
  | { type: "MOVE_POINT"; id: string; lat: number; lng: number }
  | { type: "SELECT_POINT"; id: string }
  | { type: "DELETE_POINT" };

/** The smallest free zone_N, so deleting the last zone reuses its number. */
function nextZoneId(zones: GeofenceZone[]): string {
  const taken = new Set(zones.map((zone) => zone.zoneId));
  let n = 1;
  while (taken.has(`zone_${n}`)) n += 1;
  return `zone_${n}`;
}

function withNewZone(state: GeofenceEditorState, draft: GeofenceZone[]): GeofenceEditorState {
  const zoneId = nextZoneId(draft);
  return { ...state, draft: [...draft, { zoneId, points: [] }], selectedZoneId: zoneId, selectedPointId: null };
}

function updatePoints(
  draft: GeofenceZone[],
  zoneId: string | null,
  update: (points: GeofencePoint[]) => GeofencePoint[],
): GeofenceZone[] {
  return draft.map((zone) => (zone.zoneId === zoneId ? { ...zone, points: update(zone.points) } : zone));
}

export function geofenceEditorReducer(state: GeofenceEditorState, action: GeofenceEditorAction): GeofenceEditorState {
  if (action.type === "LOADED") {
    let nextPointId = state.nextPointId;
    const saved = action.zones.map((zone) => ({
      zoneId: zone.zone_id,
      points: zone.points.map((point) => ({ id: `p${nextPointId++}`, lat: point.lat, lng: point.lon })),
    }));
    return { ...INITIAL_STATE, saved, nextPointId };
  }
  if (action.type === "BEGIN_EDIT") {
    return { ...state, draft: state.saved, selectedZoneId: state.saved[0]?.zoneId ?? null, selectedPointId: null };
  }

  const { draft } = state;
  if (!draft) return state;

  switch (action.type) {
    case "CANCEL_EDIT":
      return { ...state, draft: null, selectedZoneId: null, selectedPointId: null };
    case "ADD_ZONE":
      return withNewZone(state, draft);
    case "DELETE_ZONE": {
      const remaining = draft.filter((zone) => zone.zoneId !== action.zoneId);
      const selectedZoneId = state.selectedZoneId === action.zoneId ? (remaining[0]?.zoneId ?? null) : state.selectedZoneId;
      return { ...state, draft: remaining, selectedZoneId, selectedPointId: null };
    }
    case "SELECT_ZONE":
      return { ...state, selectedZoneId: action.zoneId, selectedPointId: null };
    case "ADD_POINT": {
      const target = state.selectedZoneId === null ? withNewZone(state, draft) : state;
      const id = `p${target.nextPointId}`;
      return {
        ...target,
        draft: updatePoints(target.draft ?? [], target.selectedZoneId, (points) => [
          ...points,
          { id, lat: action.lat, lng: action.lng },
        ]),
        selectedPointId: id,
        nextPointId: target.nextPointId + 1,
      };
    }
    case "INSERT_POINT": {
      const id = `p${state.nextPointId}`;
      return {
        ...state,
        draft: updatePoints(draft, state.selectedZoneId, (points) =>
          points.flatMap((point) =>
            point.id === action.afterId ? [point, { id, lat: action.lat, lng: action.lng }] : [point],
          ),
        ),
        selectedPointId: id,
        nextPointId: state.nextPointId + 1,
      };
    }
    case "MOVE_POINT":
      return {
        ...state,
        draft: updatePoints(draft, state.selectedZoneId, (points) =>
          points.map((point) => (point.id === action.id ? { ...point, lat: action.lat, lng: action.lng } : point)),
        ),
      };
    case "SELECT_POINT":
      return { ...state, selectedPointId: action.id };
    case "DELETE_POINT":
      return {
        ...state,
        draft: updatePoints(draft, state.selectedZoneId, (points) =>
          points.filter((point) => point.id !== state.selectedPointId),
        ),
        selectedPointId: null,
      };
  }
}

/** The zones on screen: the draft while editing, otherwise the saved ones. */
export function shownZones(state: GeofenceEditorState): GeofenceZone[] {
  return state.draft ?? state.saved;
}

export function canSubmit(state: GeofenceEditorState): boolean {
  return state.draft !== null && state.draft.every((zone) => zone.points.length >= MIN_ZONE_POINTS);
}

export function toWireZones(zones: GeofenceZone[]): GeofenceSet["zones"] {
  return zones.map((zone) => ({
    zone_id: zone.zoneId,
    points: zone.points.map((point) => ({ lat: point.lat, lon: point.lng })),
  }));
}
