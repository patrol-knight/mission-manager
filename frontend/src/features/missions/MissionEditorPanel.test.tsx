import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { MissionEditorProvider } from "./MissionEditorContext";
import { useMissionEditor } from "./useMissionEditor";
import { MissionEditorPanel } from "./MissionEditorPanel";
import * as missionApi from "../../api/missionApi";
import * as mapApi from "../../api/mapApi";

vi.mock("../../api/missionApi", () => ({
  validateRoute: vi.fn(),
  saveMission: vi.fn(),
}));

vi.mock("../../api/mapApi", () => ({
  snapWaypoint: vi.fn(),
  xyToLngLat: vi.fn(async () => ({ lat: 0, lon: 0 })),
}));

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

describe("MissionEditorPanel — snap to lanelet centerline on Validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(missionApi.validateRoute).mockResolvedValue({ valid: true, route: null, errors: [] });
  });

  it("snaps every waypoint to its nearest centerline before validating, and validates using the snapped coordinates", async () => {
    vi.mocked(mapApi.snapWaypoint).mockImplementation(async (x, y) => ({
      x: x + 10,
      y: y + 10,
      frameId: "map",
      laneletId: 1,
    }));

    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    await userEvent.click(await screen.findByText("Validate Route"));

    expect(mapApi.snapWaypoint).toHaveBeenCalledTimes(2);
    expect(mapApi.snapWaypoint).toHaveBeenCalledWith(0, 0);
    expect(mapApi.snapWaypoint).toHaveBeenCalledWith(1, 1);

    const [snappedArg] = vi.mocked(missionApi.validateRoute).mock.calls[0];
    expect(snappedArg.map((wp) => [wp.x, wp.y])).toEqual([[10, 10], [11, 11]]);

    const list = screen.getByText("Waypoints").closest("div")!;
    expect(within(list).getByText("(10.00, 10.00)")).toBeInTheDocument();
    expect(within(list).getByText("(11.00, 11.00)")).toBeInTheDocument();
  });

  it("falls back to a waypoint's original coordinates when snapping it fails", async () => {
    vi.mocked(mapApi.snapWaypoint).mockImplementation(async (x, y) => {
      if (x === 1 && y === 1) throw new Error("map unavailable");
      return { x: x + 10, y: y + 10, frameId: "map", laneletId: 1 };
    });

    render(<Harness points={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} />);
    await userEvent.click(await screen.findByText("Validate Route"));

    const [snappedArg] = vi.mocked(missionApi.validateRoute).mock.calls[0];
    expect(snappedArg.map((wp) => [wp.x, wp.y])).toEqual([[10, 10], [1, 1]]);

    const list = screen.getByText("Waypoints").closest("div")!;
    expect(within(list).getByText("(10.00, 10.00)")).toBeInTheDocument();
    expect(within(list).getByText("(1.00, 1.00)")).toBeInTheDocument();
  });
});
