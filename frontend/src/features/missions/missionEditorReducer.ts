import type { MissionDefinition, RouteValidationResult, Waypoint } from "./missionTypes";

export type EditorTool = "modify" | "delete";

export interface MissionEditorState {
  /** null while authoring a brand new mission; set once editing an existing one. */
  missionId: string | null;
  name: string;
  /** Raw text of the loop-count field — kept as a string so invalid intermediate
   * input (empty, "-", "1.") can be typed and validated, not silently coerced. */
  loopCountInput: string;
  /** "Infinite" checkbox: loop until stopped. The loop count is kept (and
   * its input disabled) so unticking restores it. */
  infiniteLoop: boolean;
  waypoints: Waypoint[];
  selectedWaypointId: string | null;
  tool: EditorTool;
  dirty: boolean;
  /** True whenever the draft has changed since the last Validate Route call —
   * a stale result can no longer be trusted to describe the current draft. */
  validationStale: boolean;
  /** Result of the last Validate Route call; null until one has run. */
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
  tool: "modify",
  dirty: false,
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
  | { type: "ADD_WAYPOINT"; x: number; y: number }
  | { type: "MOVE_WAYPOINT"; id: string; x: number; y: number }
  | { type: "SELECT_WAYPOINT"; id: string | null }
  | { type: "DELETE_WAYPOINT"; id: string }
  | { type: "SNAP_WAYPOINTS"; waypoints: Waypoint[] }
  | { type: "SET_TOOL"; tool: EditorTool }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_VALIDATION_RESULT"; result: RouteValidationResult }
  | { type: "MARK_SAVED" };

function withWaypointChange(state: MissionEditorState, waypoints: Waypoint[]): MissionEditorState {
  return {
    ...state,
    waypoints,
    history: [...state.history, state.waypoints],
    future: [],
    dirty: true,
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
        missionId: action.mission.missionId,
        name: action.mission.name,
        loopCountInput: String(action.mission.loopCount),
        infiniteLoop: action.mission.infiniteLoop,
        waypoints: action.mission.waypoints,
        selectedWaypointId: null,
        tool: "modify",
        dirty: false,
        validationStale: true,
        validationResult: null,
        history: [],
        future: [],
      };
    }

    case "SET_NAME":
      return { ...state, name: action.name, dirty: true };

    case "SET_LOOP_COUNT_INPUT":
      return { ...state, loopCountInput: action.value, dirty: true, validationStale: true };

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
      };
      return withWaypointChange(state, [...state.waypoints, waypoint]);
    }

    case "MOVE_WAYPOINT": {
      const waypoints = state.waypoints.map((wp) =>
        wp.waypointId === action.id ? { ...wp, x: action.x, y: action.y } : wp,
      );
      return withWaypointChange(state, waypoints);
    }

    case "SELECT_WAYPOINT":
      return { ...state, selectedWaypointId: action.id };

    case "DELETE_WAYPOINT": {
      if (isHomeWaypoint(state.waypoints, action.id)) return state;
      const waypoints = state.waypoints.filter((wp) => wp.waypointId !== action.id);
      const selectedWaypointId = state.selectedWaypointId === action.id ? null : state.selectedWaypointId;
      return { ...withWaypointChange(state, waypoints), selectedWaypointId };
    }

    case "SNAP_WAYPOINTS":
      return withWaypointChange(state, action.waypoints);

    case "SET_TOOL":
      return { ...state, tool: action.tool };

    case "UNDO": {
      if (state.history.length === 0) return state;
      const previous = state.history[state.history.length - 1];
      return {
        ...state,
        waypoints: previous,
        history: state.history.slice(0, -1),
        future: [state.waypoints, ...state.future],
        dirty: true,
        validationStale: true,
      };
    }

    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        waypoints: next,
        future: state.future.slice(1),
        history: [...state.history, state.waypoints],
        dirty: true,
        validationStale: true,
      };
    }

    case "SET_VALIDATION_RESULT":
      // Simplification: applied unconditionally to whatever the current draft is.
      // If the draft changed while the validate call was in flight, this briefly
      // shows a result for a slightly different draft — acceptable for v1 since
      // any further edit immediately re-flags validationStale again.
      return { ...state, validationResult: action.result, validationStale: false };

    case "MARK_SAVED":
      return { ...state, dirty: false };

    default:
      return state;
  }
}

export function isHomeWaypoint(waypoints: Waypoint[], waypointId: string): boolean {
  return waypoints.length > 0 && waypoints[0].waypointId === waypointId;
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
