import type { MissionDefinition, RouteValidationResult, Waypoint } from "./missionTypes";

export interface MissionEditorState {
  /** null while authoring a brand new mission; set once editing an existing one. */
  missionId: string | null;
  name: string;
  /** Raw text of the loop-count field — kept as a string so invalid intermediate
   * input (empty, "-", "1.") can be typed and validated, not silently coerced. */
  loopCountInput: string;
  /** "Infinite" toggle: loop until stopped. The loop count is kept (and its
   * input disabled) so untoggling restores it. */
  infiniteLoop: boolean;
  waypoints: Waypoint[];
  selectedWaypointId: string | null;
  dirty: boolean;
  /** Bumped on every change to the waypoints. A route check is tagged with
   * the revision it ran against, so a result that arrives after the draft
   * moved on is dropped instead of describing the wrong route. */
  revision: number;
  /** True until a route check for the current revision has come back. */
  validationStale: boolean;
  /** Result of the last route check; null until one has run. */
  validationResult: RouteValidationResult | null;
  history: Waypoint[][];
  future: Waypoint[][];
}

export const BLANK_STATE: MissionEditorState = {
  missionId: null,
  name: "",
  loopCountInput: "1",
  infiniteLoop: false,
  waypoints: [],
  selectedWaypointId: null,
  dirty: false,
  revision: 0,
  validationStale: true,
  validationResult: null,
  history: [],
  future: [],
};

export type MissionEditorAction =
  | { type: "OPEN"; mission: MissionDefinition | null }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_LOOP_COUNT_INPUT"; value: string }
  | { type: "SET_INFINITE_LOOP"; value: boolean }
  | { type: "ADD_WAYPOINT"; x: number; y: number; lat?: number | null; lon?: number | null }
  | { type: "MOVE_WAYPOINT"; id: string; x: number; y: number; lat?: number | null; lon?: number | null }
  | { type: "SELECT_WAYPOINT"; id: string | null }
  | { type: "DELETE_WAYPOINT"; id: string }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_VALIDATION_RESULT"; result: RouteValidationResult; revision: number }
  | { type: "MARK_SAVED" };

/** A waypoint edit: one undo step, and the route needs checking again. */
function withWaypoints(state: MissionEditorState, waypoints: Waypoint[], history: Waypoint[][], future: Waypoint[][]) {
  const selectedWaypointId = waypoints.some((wp) => wp.waypointId === state.selectedWaypointId)
    ? state.selectedWaypointId
    : null;
  return {
    ...state,
    waypoints,
    selectedWaypointId,
    history,
    future,
    dirty: true,
    revision: state.revision + 1,
    validationStale: true,
  };
}

export function missionEditorReducer(
  state: MissionEditorState,
  action: MissionEditorAction,
): MissionEditorState {
  switch (action.type) {
    case "OPEN": {
      if (!action.mission) return { ...BLANK_STATE };
      return {
        ...BLANK_STATE,
        missionId: action.mission.missionId,
        name: action.mission.name,
        loopCountInput: String(action.mission.loopCount),
        infiniteLoop: action.mission.infiniteLoop,
        waypoints: action.mission.waypoints,
      };
    }

    case "SET_NAME":
      return { ...state, name: action.name, dirty: true };

    // Loops don't change the route, so neither of these needs a new check.
    case "SET_LOOP_COUNT_INPUT":
      return { ...state, loopCountInput: action.value, dirty: true };

    case "SET_INFINITE_LOOP":
      return { ...state, infiniteLoop: action.value, dirty: true };

    case "ADD_WAYPOINT": {
      const waypoint: Waypoint = {
        waypointId: crypto.randomUUID(),
        x: action.x,
        y: action.y,
        yaw: null,
        label: null,
        type: "patrol",
        lat: action.lat,
        lon: action.lon,
      };
      return {
        ...withWaypoints(state, [...state.waypoints, waypoint], [...state.history, state.waypoints], []),
        selectedWaypointId: waypoint.waypointId,
      };
    }

    case "MOVE_WAYPOINT": {
      const waypoints = state.waypoints.map((wp) =>
        wp.waypointId === action.id ? { ...wp, x: action.x, y: action.y, lat: action.lat, lon: action.lon } : wp,
      );
      return withWaypoints(state, waypoints, [...state.history, state.waypoints], []);
    }

    case "SELECT_WAYPOINT":
      return { ...state, selectedWaypointId: action.id };

    case "DELETE_WAYPOINT": {
      if (!state.waypoints.some((wp) => wp.waypointId === action.id)) return state;
      const waypoints = state.waypoints.filter((wp) => wp.waypointId !== action.id);
      return withWaypoints(state, waypoints, [...state.history, state.waypoints], []);
    }

    case "UNDO": {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return withWaypoints(state, previous, state.history.slice(0, -1), [state.waypoints, ...state.future]);
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const [next, ...future] = state.future;
      return withWaypoints(state, next, [...state.history, state.waypoints], future);
    }

    case "SET_VALIDATION_RESULT":
      if (action.revision !== state.revision) return state; // checked an older draft
      return { ...state, validationResult: action.result, validationStale: false };

    case "MARK_SAVED":
      return { ...state, dirty: false };

    default:
      return state;
  }
}

export function parseLoopCount(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 ? n : null;
}

export function isNameValid(name: string): boolean {
  return name.trim().length > 0;
}

export function canSave(state: MissionEditorState): boolean {
  return (
    isNameValid(state.name) &&
    (state.infiniteLoop || parseLoopCount(state.loopCountInput) !== null) &&
    state.waypoints.length >= 2 &&
    !state.validationStale &&
    state.validationResult?.valid === true
  );
}
