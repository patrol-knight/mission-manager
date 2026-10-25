import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { MissionCompleteWatcher } from "./MissionCompleteWatcher";
import { useMissionStore } from "../../stores/missionStore";
import type { MissionDefinition, MissionExecutionState, MissionStatus } from "./missionTypes";

const definition = { missionId: "m1", loopCount: 3 } as MissionDefinition;

function execution(status: MissionStatus, completedLoops = 0): MissionExecutionState {
  return {
    missionId: "m1",
    status,
    currentLoop: completedLoops,
    completedLoops,
    currentWaypointIndex: 0,
    targetWaypointIndex: null,
    joining: false,
    updatedAt: null,
  };
}

describe("MissionCompleteWatcher", () => {
  beforeEach(() => {
    useMissionStore.setState({ definition, execution: execution("running", 2) });
  });

  it("toasts once when the mission completes", () => {
    render(<ToastProvider><MissionCompleteWatcher /></ToastProvider>);
    act(() => useMissionStore.getState().setExecution(execution("completed", 3)));
    act(() => useMissionStore.getState().setExecution(execution("ready")));
    expect(screen.getAllByText("Mission Complete!")).toHaveLength(1);
    expect(screen.getByText("3 / 3 loops completed")).toBeInTheDocument();
  });

  it("stays quiet when the mission is cancelled", () => {
    render(<ToastProvider><MissionCompleteWatcher /></ToastProvider>);
    act(() => useMissionStore.getState().setExecution(execution("ready")));
    expect(screen.queryByText("Mission Complete!")).not.toBeInTheDocument();
  });
});
