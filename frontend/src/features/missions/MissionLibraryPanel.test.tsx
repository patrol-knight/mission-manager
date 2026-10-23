import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { MissionEditorProvider } from "./MissionEditorContext";
import { useMissionEditor } from "./useMissionEditor";
import { MissionLibraryPanel } from "./MissionLibraryPanel";
import { useMissionStore } from "../../stores/missionStore";
import { useLibraryStore } from "../../stores/libraryStore";
import * as missionApi from "../../api/missionApi";
import type { MissionSummary, MissionDefinition } from "./missionTypes";

vi.mock("../../api/missionApi", () => ({
  listMissionSummaries: vi.fn(),
  getMission: vi.fn(),
  deleteMission: vi.fn(),
  activateMission: vi.fn(),
}));

const summaries: MissionSummary[] = [
  {
    missionId: "current-mission",
    name: "Patrol A",
    mapName: "demo",
    frameId: "map",
    waypointCount: 3,
    loopCount: 2,
    homeX: 1.5,
    homeY: -2.25,
    distanceM: 142,
    infiniteLoop: false,
    isCurrent: true,
    updatedAt: null,
  },
  {
    missionId: "other-mission",
    name: "Patrol B",
    mapName: "demo",
    frameId: "map",
    waypointCount: 2,
    loopCount: 1,
    homeX: null,
    homeY: null,
    distanceM: null,
    infiniteLoop: true,
    isCurrent: false,
    updatedAt: null,
  },
];

const fullMission: MissionDefinition = {
  missionId: "other-mission",
  name: "Patrol B",
  mapName: "demo",
  frameId: "map",
  description: null,
  infiniteLoop: false,
  waypoints: [],
  loopCount: 1,
  createdAt: null,
  updatedAt: null,
  metadata: {},
};

function EditorProbe() {
  const { state } = useMissionEditor();
  return <div>editor-mission-id={state.missionId ?? "none"}</div>;
}

function Harness({ onBack = vi.fn(), onEnterEditor = vi.fn() }: { onBack?: () => void; onEnterEditor?: () => void }) {
  return (
    <ToastProvider>
      <MissionEditorProvider>
        <MissionLibraryPanel onBack={onBack} onEnterEditor={onEnterEditor} />
        <EditorProbe />
      </MissionEditorProvider>
    </ToastProvider>
  );
}

describe("MissionLibraryPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(missionApi.listMissionSummaries).mockResolvedValue(summaries);
    vi.mocked(missionApi.getMission).mockResolvedValue(fullMission);
    vi.mocked(missionApi.deleteMission).mockResolvedValue(undefined);
    vi.mocked(missionApi.activateMission).mockResolvedValue(fullMission);
    useMissionStore.setState({ definition: null, execution: null });
    useLibraryStore.setState({ selectedMissionId: null });
  });

  async function selectRow(name: string) {
    await userEvent.click(await screen.findByRole("button", { name: new RegExp(name) }));
  }

  it("lists every mission as a row, the active one first and opened", async () => {
    render(<Harness />);
    expect(await screen.findByText("Patrol A")).toBeInTheDocument();
    expect(screen.getByText("3 waypoints · 142 m")).toBeInTheDocument();
    expect(screen.getByText("2 waypoints · —")).toBeInTheDocument();
    // The active row opens in an effect after the list renders.
    await waitFor(() => expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1));
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("Patrol A");
    expect(useLibraryStore.getState().selectedMissionId).toBe("current-mission");
  });

  it("opens another row on click, showing its loops and ETA", async () => {
    render(<Harness />);
    await selectRow("Patrol B");
    expect(useLibraryStore.getState().selectedMissionId).toBe("other-mission");
    expect(screen.getByText("ETA / loop")).toBeInTheDocument();
  });

  it("calls onBack when Back is clicked", async () => {
    const onBack = vi.fn();
    render(<Harness onBack={onBack} />);
    await screen.findByText("Patrol A");
    await userEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("opens a blank draft and enters the editor on New mission", async () => {
    const onEnterEditor = vi.fn();
    render(<Harness onEnterEditor={onEnterEditor} />);
    await screen.findByText("Patrol A");
    await userEvent.click(screen.getByText("New mission"));
    expect(onEnterEditor).toHaveBeenCalled();
    expect(screen.getByText("editor-mission-id=none")).toBeInTheDocument();
  });

  it("loads the mission and enters the editor on Edit", async () => {
    const onEnterEditor = vi.fn();
    render(<Harness onEnterEditor={onEnterEditor} />);
    await selectRow("Patrol B");
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await waitFor(() => expect(onEnterEditor).toHaveBeenCalled());
    expect(missionApi.getMission).toHaveBeenCalledWith("other-mission");
    expect(await screen.findByText("editor-mission-id=other-mission")).toBeInTheDocument();
  });

  it("can't activate the mission that is already active", async () => {
    render(<Harness />);
    await screen.findByText("Patrol A");
    expect(screen.getByRole("button", { name: "Active" })).toBeDisabled();
  });

  it("activates a mission directly when nothing else is running", async () => {
    render(<Harness />);
    await selectRow("Patrol B");
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(missionApi.activateMission).toHaveBeenCalledWith("other-mission"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("warns before switching the active mission while another is running", async () => {
    useMissionStore.setState({
      execution: {
        missionId: "current-mission",
        status: "running",
        currentLoop: 1,
        completedLoops: 0,
        currentWaypointIndex: 0,
        updatedAt: null,
      },
    });
    render(<Harness />);
    await selectRow("Patrol B");
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(missionApi.activateMission).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("Switch anyway"));
    await waitFor(() => expect(missionApi.activateMission).toHaveBeenCalledWith("other-mission"));
  });

  it("deletes a mission after confirming", async () => {
    render(<Harness />);
    await selectRow("Patrol B");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByText("Delete"));
    await waitFor(() => expect(missionApi.deleteMission).toHaveBeenCalledWith("other-mission"));
  });
});
