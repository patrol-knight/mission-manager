import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissionCard } from "./MissionCard";
import { ToastProvider } from "../../components/Toast";
import { useMissionStore } from "../../stores/missionStore";
import { useDeviceStore } from "../../stores/deviceStore";
import * as missionApi from "../../api/missionApi";
import type { Device } from "../../types/domain";
import type { MissionDefinition, MissionExecutionState, MissionStatus } from "./missionTypes";

vi.mock("../../hooks/useApiConnection", () => ({ useApiConnection: () => ({ status: "connected" }) }));
vi.mock("../../api/missionApi", () => ({
  startMission: vi.fn(),
  pauseMission: vi.fn(),
  resumeMission: vi.fn(),
  cancelMission: vi.fn(),
}));

const definition = {
  missionId: "m1",
  name: "Patrol",
  loopCount: 1,
  infiniteLoop: false,
  waypoints: [{ waypointId: "a" }, { waypointId: "b" }, { waypointId: "c" }],
} as unknown as MissionDefinition;

const robot = { deviceId: "robot-1", type: "robot", connected: true } as Device;

function execution(status: MissionStatus, targetWaypointIndex: number | null = null): MissionExecutionState {
  return {
    missionId: "m1",
    status,
    currentLoop: status === "running" ? 1 : 0,
    completedLoops: 0,
    currentWaypointIndex: 0,
    targetWaypointIndex,
    joining: targetWaypointIndex !== null,
    updatedAt: null,
  };
}

function renderCard() {
  render(
    <ToastProvider>
      <MissionCard onEdit={vi.fn()} onCreate={vi.fn()} />
    </ToastProvider>,
  );
}

describe("MissionCard without a current mission", () => {
  beforeEach(() => {
    useMissionStore.setState({ definition: null, execution: null });
  });

  it("offers both picking a saved mission and creating one", async () => {
    const onEdit = vi.fn();
    const onCreate = vi.fn();
    render(<MissionCard onEdit={onEdit} onCreate={onCreate} />);

    await userEvent.click(screen.getByRole("button", { name: "Choose mission" }));
    expect(onEdit).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create mission" }));
    expect(onCreate).toHaveBeenCalled();
  });
});

describe("MissionCard controls", () => {
  beforeEach(() => {
    vi.mocked(missionApi.startMission).mockReset();
    vi.mocked(missionApi.cancelMission).mockReset();
    useDeviceStore.setState({ devices: { "robot-1": robot } });
  });

  it("can't start while not ready", () => {
    useMissionStore.setState({ definition, execution: execution("not_ready") });
    renderCard();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });

  it("says which waypoint the mission starts from", async () => {
    useMissionStore.setState({ definition, execution: execution("ready") });
    vi.mocked(missionApi.startMission).mockResolvedValue(execution("running", 2));
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Starting from waypoint 3")).toBeInTheDocument();
  });

  it("cancels only once confirmed", async () => {
    useMissionStore.setState({ definition, execution: execution("running", 1) });
    vi.mocked(missionApi.cancelMission).mockResolvedValue(execution("ready"));
    renderCard();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Keep going" }));
    expect(missionApi.cancelMission).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel mission" }));
    expect(missionApi.cancelMission).toHaveBeenCalled();
    expect(await screen.findByText("Mission cancelled")).toBeInTheDocument();
  });
});
