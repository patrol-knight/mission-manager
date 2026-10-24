import { describe, it, expect } from "vitest";
import {
  missionEditorReducer,
  BLANK_STATE,
  parseLoopCount,
  isNameValid,
  canSave,
  type MissionEditorState,
} from "./missionEditorReducer";
import type { MissionDefinition, RouteValidationResult } from "./missionTypes";

const VALID_ROUTE_RESULT: RouteValidationResult = { valid: true, route: null, errors: [] };
const INVALID_ROUTE_RESULT: RouteValidationResult = {
  valid: false,
  route: null,
  errors: [{ code: "unreachable", message: "no route" }],
};

function addWaypoint(state: MissionEditorState, x: number, y: number): MissionEditorState {
  return missionEditorReducer(state, { type: "ADD_WAYPOINT", x, y });
}

/** The route check for the current draft came back with `result`. */
function validated(state: MissionEditorState, result = VALID_ROUTE_RESULT): MissionEditorState {
  return missionEditorReducer(state, { type: "SET_VALIDATION_RESULT", result, revision: state.revision });
}

describe("missionEditorReducer", () => {
  it("OPEN with null resets to a blank draft", () => {
    const dirty = addWaypoint(BLANK_STATE, 1, 2);
    expect(missionEditorReducer(dirty, { type: "OPEN", mission: null })).toEqual(BLANK_STATE);
  });

  it("OPEN with a mission seeds the draft and leaves it non-dirty", () => {
    const mission: MissionDefinition = {
      missionId: "m1",
      name: "Patrol A",
      mapName: "demo",
      frameId: "map",
      description: null,
      infiniteLoop: false,
      waypoints: [
        { waypointId: "wp1", x: 0, y: 0, yaw: null, label: null, type: "patrol" },
        { waypointId: "wp2", x: 1, y: 1, yaw: null, label: null, type: "patrol" },
      ],
      loopCount: 3,
      createdAt: null,
      updatedAt: null,
      metadata: {},
    };
    const state = missionEditorReducer(BLANK_STATE, { type: "OPEN", mission });
    expect(state.name).toBe("Patrol A");
    expect(state.loopCountInput).toBe("3");
    expect(state.waypoints).toHaveLength(2);
    expect(state.dirty).toBe(false);
  });

  it("selects a waypoint as it is added", () => {
    const state = addWaypoint(BLANK_STATE, 5, 5);
    expect(state.selectedWaypointId).toBe(state.waypoints[0].waypointId);
  });

  it("any waypoint can be deleted, including the first", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    const first = state.waypoints[0];
    state = missionEditorReducer(state, { type: "DELETE_WAYPOINT", id: first.waypointId });
    expect(state.waypoints.map((wp) => wp.x)).toEqual([1]);
  });

  it("a waypoint can be deleted directly by id, clearing its selection", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    const second = state.waypoints[1];
    state = missionEditorReducer(state, { type: "SELECT_WAYPOINT", id: second.waypointId });
    state = missionEditorReducer(state, { type: "DELETE_WAYPOINT", id: second.waypointId });
    expect(state.waypoints).toHaveLength(1);
    expect(state.selectedWaypointId).toBeNull();
  });

  it("deleting a waypoint that isn't selected doesn't disturb the current selection", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = addWaypoint(state, 2, 2);
    const first = state.waypoints[0];
    const third = state.waypoints[2];
    state = missionEditorReducer(state, { type: "SELECT_WAYPOINT", id: first.waypointId });
    state = missionEditorReducer(state, { type: "DELETE_WAYPOINT", id: third.waypointId });
    expect(state.selectedWaypointId).toBe(first.waypointId);
  });

  it("MOVE_WAYPOINT updates coordinates without changing order or ids", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    const id = state.waypoints[0].waypointId;
    state = missionEditorReducer(state, { type: "MOVE_WAYPOINT", id, x: 9, y: 9 });
    expect(state.waypoints[0]).toMatchObject({ waypointId: id, x: 9, y: 9 });
  });

  it("drops a route check that ran against an older draft", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    const checkedRevision = state.revision;
    state = addWaypoint(state, 2, 2); // edited while the check was in flight
    state = missionEditorReducer(state, {
      type: "SET_VALIDATION_RESULT",
      result: VALID_ROUTE_RESULT,
      revision: checkedRevision,
    });
    expect(state.validationStale).toBe(true);
    expect(state.validationResult).toBeNull();
  });

  it("undo and redo are waypoint edits too: the route needs checking again", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = validated(state);
    state = missionEditorReducer(state, { type: "UNDO" });
    expect(state.validationStale).toBe(true);
  });

  it("changing the loops doesn't invalidate the route", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = validated(state);
    state = missionEditorReducer(state, { type: "SET_LOOP_COUNT_INPUT", value: "3" });
    state = missionEditorReducer(state, { type: "SET_INFINITE_LOOP", value: true });
    expect(state.validationStale).toBe(false);
  });

  it("undo reverts the last waypoint mutation and redo replays it", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    expect(state.waypoints).toHaveLength(2);

    state = missionEditorReducer(state, { type: "UNDO" });
    expect(state.waypoints).toHaveLength(1);

    state = missionEditorReducer(state, { type: "REDO" });
    expect(state.waypoints).toHaveLength(2);
  });

  it("undo on an empty history is a no-op", () => {
    expect(missionEditorReducer(BLANK_STATE, { type: "UNDO" })).toBe(BLANK_STATE);
  });

  it("a fresh waypoint mutation clears the redo stack", () => {
    let state = addWaypoint(BLANK_STATE, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = missionEditorReducer(state, { type: "UNDO" });
    expect(state.future).toHaveLength(1);
    state = addWaypoint(state, 2, 2);
    expect(state.future).toHaveLength(0);
  });

  it("every waypoint mutation marks the draft dirty and validation stale", () => {
    const state = addWaypoint(BLANK_STATE, 0, 0);
    expect(state.dirty).toBe(true);
    expect(state.validationStale).toBe(true);
  });
});

describe("parseLoopCount", () => {
  it.each([
    ["1", 1],
    ["10", 10],
    ["007", 7],
  ])("accepts %s -> %d", (input, expected) => {
    expect(parseLoopCount(input)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "", "abc", "NaN"])("rejects %s", (input) => {
    expect(parseLoopCount(input)).toBeNull();
  });
});

describe("isNameValid", () => {
  it("rejects empty or whitespace-only names", () => {
    expect(isNameValid("")).toBe(false);
    expect(isNameValid("   ")).toBe(false);
  });

  it("accepts a non-empty name", () => {
    expect(isNameValid("Patrol A")).toBe(true);
  });
});


describe("canSave", () => {
  it("requires a valid name, loop count, at least two waypoints, and a fresh successful validation", () => {
    let state = BLANK_STATE;
    expect(canSave(state)).toBe(false);

    state = missionEditorReducer(state, { type: "SET_NAME", name: "Patrol A" });
    expect(canSave(state)).toBe(false); // still <2 waypoints

    state = addWaypoint(state, 0, 0);
    state = addWaypoint(state, 1, 1);
    expect(canSave(state)).toBe(false); // waypoints exist but never validated

    state = validated(state);
    expect(canSave(state)).toBe(true);

    state = missionEditorReducer(state, { type: "SET_LOOP_COUNT_INPUT", value: "0" });
    expect(canSave(state)).toBe(false);
  });

  it("an infinite mission saves without a valid loop count, which is kept for later", () => {
    let state = missionEditorReducer(BLANK_STATE, { type: "SET_NAME", name: "Patrol A" });
    state = addWaypoint(state, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = missionEditorReducer(state, { type: "SET_LOOP_COUNT_INPUT", value: "" });
    state = validated(state);
    expect(canSave(state)).toBe(false);

    state = missionEditorReducer(state, { type: "SET_INFINITE_LOOP", value: true });
    expect(state.dirty).toBe(true);
    expect(canSave(state)).toBe(true);
    expect(state.loopCountInput).toBe("");
  });

  it("blocks save when the last validation failed", () => {
    let state = missionEditorReducer(BLANK_STATE, { type: "SET_NAME", name: "Patrol A" });
    state = addWaypoint(state, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = validated(state, INVALID_ROUTE_RESULT);
    expect(canSave(state)).toBe(false);
  });

  it("re-flags validation as stale after any further waypoint edit", () => {
    let state = missionEditorReducer(BLANK_STATE, { type: "SET_NAME", name: "Patrol A" });
    state = addWaypoint(state, 0, 0);
    state = addWaypoint(state, 1, 1);
    state = validated(state);
    expect(canSave(state)).toBe(true);

    state = addWaypoint(state, 2, 2);
    expect(state.validationStale).toBe(true);
    expect(canSave(state)).toBe(false);
  });
});
