import { describe, expect, it } from "vitest";
import {
  canSubmit,
  geofenceEditorReducer as reduce,
  INITIAL_STATE,
  shownZones,
  toWireZones,
  type GeofenceEditorAction,
  type GeofenceEditorState,
} from "./geofenceEditorReducer";

const SAVED = [
  {
    zone_id: "zone_1",
    points: [
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
      { lat: 5, lon: 6 },
    ],
  },
];

const run = (state: GeofenceEditorState, ...actions: GeofenceEditorAction[]) => actions.reduce(reduce, state);
const point = (lat: number, lng = lat): GeofenceEditorAction => ({ type: "ADD_POINT", lat, lng });
const loaded = reduce(INITIAL_STATE, { type: "LOADED", zones: SAVED });

describe("geofenceEditorReducer", () => {
  it("ignores edits outside edit mode", () => {
    expect(run(loaded, point(1), { type: "ADD_ZONE" })).toEqual(loaded);
  });

  it("starts a zone on the first click when none is selected", () => {
    const state = run(INITIAL_STATE, { type: "BEGIN_EDIT" }, point(1), point(2));
    expect(state.draft?.map((zone) => [zone.zoneId, zone.points.length])).toEqual([["zone_1", 2]]);
  });

  it("adds points to the selected zone, and a new zone takes the next free id", () => {
    const state = run(loaded, { type: "BEGIN_EDIT" }, { type: "ADD_ZONE" }, point(9));
    expect(state.draft?.map((zone) => [zone.zoneId, zone.points.length])).toEqual([
      ["zone_1", 3],
      ["zone_2", 1],
    ]);
  });

  it("cancel keeps the saved zones and leaves no draft", () => {
    const state = run(loaded, { type: "BEGIN_EDIT" }, point(9), { type: "CANCEL_EDIT" });
    expect(state.draft).toBeNull();
    expect(shownZones(state)).toEqual(loaded.saved);
  });

  it("moves, inserts after and deletes a point", () => {
    const editing = run(loaded, { type: "BEGIN_EDIT" });
    const [first, second, third] = editing.draft![0].points;

    const moved = run(editing, { type: "MOVE_POINT", id: second.id, lat: 7, lng: 8 });
    expect(moved.draft![0].points[1]).toMatchObject({ lat: 7, lng: 8 });

    const inserted = run(moved, { type: "INSERT_POINT", afterId: first.id, lat: 0, lng: 0 });
    expect(inserted.draft![0].points.map((p) => p.lat)).toEqual([1, 0, 7, 5]);
    expect(inserted.selectedPointId).toBe(inserted.draft![0].points[1].id);

    const deleted = run(inserted, { type: "SELECT_POINT", id: third.id }, { type: "DELETE_POINT" });
    expect(deleted.draft![0].points.map((p) => p.lat)).toEqual([1, 0, 7]);
    expect(deleted.selectedPointId).toBeNull();
  });

  it("deleting the selected zone selects another", () => {
    const state = run(loaded, { type: "BEGIN_EDIT" }, { type: "ADD_ZONE" }, { type: "DELETE_ZONE", zoneId: "zone_2" });
    expect(state.selectedZoneId).toBe("zone_1");
  });

  it("can't submit a zone with under three points, but can submit no zones", () => {
    const editing = run(loaded, { type: "BEGIN_EDIT" });
    expect(canSubmit(loaded)).toBe(false);
    expect(canSubmit(editing)).toBe(true);
    expect(canSubmit(run(editing, { type: "ADD_ZONE" }, point(9), point(8)))).toBe(false);
    expect(canSubmit(run(editing, { type: "DELETE_ZONE", zoneId: "zone_1" }))).toBe(true);
  });

  it("round-trips the wire format", () => {
    expect(toWireZones(loaded.saved)).toEqual(SAVED);
  });
});
