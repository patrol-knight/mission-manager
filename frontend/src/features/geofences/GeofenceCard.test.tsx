import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GeofenceCard } from "./GeofenceCard";
import { geofenceEditorReducer, INITIAL_STATE, type GeofenceEditorState } from "./geofenceEditorReducer";

const SAVED = geofenceEditorReducer(INITIAL_STATE, {
  type: "LOADED",
  zones: [{ zone_id: "zone_1", points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { lat: 5, lon: 6 }] }],
});
const EDITING = geofenceEditorReducer(SAVED, { type: "BEGIN_EDIT" });

function renderCard(state: GeofenceEditorState, disabled = false) {
  const dispatch = vi.fn();
  const submit = vi.fn();
  render(
    <GeofenceCard editor={{ state, dispatch, submit, submitting: false, error: null }} disabled={disabled} />,
  );
  return { dispatch, submit };
}

describe("GeofenceCard", () => {
  it("lists saved zones and starts editing", async () => {
    const { dispatch } = renderCard(SAVED);
    expect(screen.getByText("zone_1")).toBeInTheDocument();
    expect(screen.getByText("3 points")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "BEGIN_EDIT" });
  });

  it("can't start editing while another map tool is active", () => {
    renderCard(SAVED, true);
    expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  });

  it("cancels and submits while editing", async () => {
    const { dispatch, submit } = renderCard(EDITING);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_EDIT" });
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(submit).toHaveBeenCalled();
  });

  it("blocks Submit while a zone is incomplete", () => {
    renderCard(geofenceEditorReducer(EDITING, { type: "ADD_ZONE" }));
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
  });
});
