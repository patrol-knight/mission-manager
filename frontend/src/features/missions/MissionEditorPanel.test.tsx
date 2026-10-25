import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { MissionEditorProvider } from "./MissionEditorContext";
import { useMissionEditor } from "./useMissionEditor";
import { MissionEditorPanel } from "./MissionEditorPanel";
import * as missionApi from "../../api/missionApi";

vi.mock("../../api/missionApi", () => ({
  validateRoute: vi.fn(),
  saveMission: vi.fn(),
}));

vi.mock("../../api/mapApi", () => ({
  xyToLngLat: vi.fn(async () => ({ lat: 0, lon: 0 })),
}));

const ROUTE = {
  type: "Feature" as const,
  geometry: { type: "LineString" as const, coordinates: [] },
  properties: { length_m: 162 },
};

function Seeder({ points }: { points: Array<{ x: number; y: number }> }) {
  const { dispatch } = useMissionEditor();
  useEffect(() => {
    for (const p of points) dispatch({ type: "ADD_WAYPOINT", x: p.x, y: p.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Harness({ points }: { points: Array<{ x: number; y: number }> }) {
  return (
    <ToastProvider>
      <MissionEditorProvider>
        <Seeder points={points} />
        <MissionEditorPanel onCancel={vi.fn()} onSaved={vi.fn()} />
      </MissionEditorProvider>
    </ToastProvider>
  );
}

describe("MissionEditorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(missionApi.validateRoute).mockResolvedValue({ valid: true, route: ROUTE, errors: [] });
  });

  it("checks the route on its own once there are two waypoints, in one request", async () => {
    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    expect(await screen.findByText("Route OK · 162 m per loop")).toBeInTheDocument();
    expect(missionApi.validateRoute).toHaveBeenCalledTimes(1);
    const [checked] = vi.mocked(missionApi.validateRoute).mock.calls[0];
    expect(checked.map((wp) => [wp.x, wp.y])).toEqual([[0, 0], [1, 1]]);
  });

  it("doesn't check a single waypoint", async () => {
    render(<Harness points={[{ x: 0, y: 0 }]} />);
    expect(screen.getByText("Add at least one more waypoint.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 500));
    expect(missionApi.validateRoute).not.toHaveBeenCalled();
  });

  it("enables Save only for a named mission whose route checked out", async () => {
    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    await screen.findByText(/Route OK/);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Mission name"), "Patrol A");
    expect(save).toBeEnabled();
  });

  it("shows why an unreachable route can't be saved", async () => {
    vi.mocked(missionApi.validateRoute).mockResolvedValue({
      valid: false,
      route: null,
      errors: [{ code: "route_unreachable", message: "No route could be computed between the given waypoints." }],
    });
    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    expect(await screen.findByText("No route could be computed between the given waypoints.")).toBeInTheDocument();
  });

  it("removes the selected waypoint with the Delete key and brings it back with Ctrl+Z", async () => {
    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    await screen.findByText(/Route OK/);
    // The last added waypoint is selected.
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(screen.queryByText("1.00, 1.00")).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(await screen.findByText("1.00, 1.00")).toBeInTheDocument();
  });
});
