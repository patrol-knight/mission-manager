import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { AnomalyCard } from "../anomalies/AnomalyCard";
import { InvestigateCard } from "./InvestigateCard";
import { useDeviceStore } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import * as investigationApi from "../../api/investigationApi";
import type { Anomaly } from "../anomalies/anomalyTypes";
import type { Device } from "../../types/domain";
import type { Investigation } from "./investigationTypes";
import type { MissionDefinition } from "../missions/missionTypes";

vi.mock("../../hooks/useApiConnection", () => ({ useApiConnection: () => ({ status: "connected" }) }));
vi.mock("../../api/investigationApi", () => ({
  startInvestigation: vi.fn(),
  setVerdict: vi.fn(),
  cancelInvestigation: vi.fn(),
  finishInvestigation: vi.fn(),
}));

const anomaly: Anomaly = {
  anomalyId: "6f1c2a8e-3b4d-4e5f-9a0b-1c2d3e4f5a6b",
  types: ["lying_down"],
  x: 10,
  y: 0,
  frameId: "map",
  confidence: 0.92,
  sourceDeviceId: "iot-01",
  detectedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  degradeSec: 30,
  expiresAt: new Date(Date.now() + 30_000).toISOString(),
  lat: 1,
  lon: 2,
  resolution: null,
  resolvedAt: null,
  missionId: null,
};

const robot: Device = {
  deviceId: "robot-1",
  name: "Robot",
  type: "robot",
  pose: { frameId: "map", x: 0, y: 0, yaw: 0, lat: 1, lon: 2 },
  timestamp: 1,
  battery: 90,
  speed: 0,
  status: {},
  capabilities: [],
  connected: true,
  lastSeen: 1,
};

const investigation: Investigation = {
  anomalyId: anomaly.anomalyId,
  robotDeviceId: "robot-1",
  phase: "en_route",
  target: { x: 10, y: 0, frameId: "map", lat: 1, lon: 2 },
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
  draftVerdict: null,
  startedAt: new Date().toISOString(),
  arrivedAt: null,
};

const definition = { missionId: "m1", name: "Mission 1", loopCount: 1, waypoints: [{}, {}] } as unknown as MissionDefinition;

function renderWithToasts(ui: React.ReactNode) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("AnomalyCard", () => {
  beforeEach(() => {
    vi.mocked(investigationApi.startInvestigation).mockReset();
    useDeviceStore.setState({ devices: { "robot-1": robot }, anomalies: { [anomaly.anomalyId]: anomaly } });
    useInvestigationStore.setState({ investigation: null, selectedAnomalyId: anomaly.anomalyId, verifyOpen: false });
  });

  it("shows what the operator needs to decide", () => {
    renderWithToasts(<AnomalyCard />);
    expect(screen.getByText("Anomaly-6f1c2a8e")).toBeInTheDocument();
    expect(screen.getByText("Lying down")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("Cancel deselects without investigating", async () => {
    renderWithToasts(<AnomalyCard />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
    expect(investigationApi.startInvestigation).not.toHaveBeenCalled();
  });

  it("can't investigate while the robot is offline", () => {
    useDeviceStore.setState({ devices: { "robot-1": { ...robot, connected: false } } });
    renderWithToasts(<AnomalyCard />);
    expect(screen.getByRole("button", { name: "Investigate" })).toBeDisabled();
    expect(document.querySelector('[data-hint="The robot is offline"]')).toBeInTheDocument();
  });

  it("stays open once the anomaly expires, offering only Dismiss", async () => {
    renderWithToasts(<AnomalyCard />);
    act(() => useDeviceStore.setState({ anomalies: {} }));
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("No longer detected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Investigate" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
  });

  it("starts the investigation and hands over to the Investigate card", async () => {
    vi.mocked(investigationApi.startInvestigation).mockResolvedValue(investigation);
    renderWithToasts(<AnomalyCard />);
    await userEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(investigationApi.startInvestigation).toHaveBeenCalledWith(anomaly.anomalyId);
    expect(useInvestigationStore.getState().investigation).toEqual(investigation);
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
  });
});

describe("InvestigateCard", () => {
  beforeEach(() => {
    vi.mocked(investigationApi.cancelInvestigation).mockReset();
    vi.mocked(investigationApi.finishInvestigation).mockReset();
    useDeviceStore.setState({ devices: { "robot-1": robot }, anomalies: { [anomaly.anomalyId]: anomaly } });
    useMissionStore.setState({
      definition,
      execution: {
        missionId: "m1",
        status: "ready",
        currentLoop: 0,
        completedLoops: 0,
        currentWaypointIndex: 0,
        targetWaypointIndex: null,
        joining: false,
        updatedAt: null,
      },
    });
    useInvestigationStore.setState({ investigation, selectedAnomalyId: null, verifyOpen: false });
  });

  it("cancels at once while en route and says where the robot goes", async () => {
    vi.mocked(investigationApi.cancelInvestigation).mockResolvedValue(undefined);
    renderWithToasts(<InvestigateCard />);
    expect(screen.getByText("Anomaly-6f1c2a8e")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(investigationApi.cancelInvestigation).toHaveBeenCalled();
    expect(useInvestigationStore.getState().investigation).toBeNull();
    expect(await screen.findByText("Investigation cancelled")).toBeInTheDocument();
    expect(screen.getByText("The robot is holding its position")).toBeInTheDocument();
  });

  it("requires a verdict before Submit on site", () => {
    useInvestigationStore.setState({ investigation: { ...investigation, phase: "on_site" } });
    renderWithToasts(<InvestigateCard />);
    expect(screen.getByRole("button", { name: "Verify" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(document.querySelector('[data-hint="Choose a verdict in Verify first"]')).toBeInTheDocument();
  });

  it("submits at once and toasts the recorded verdict", async () => {
    vi.mocked(investigationApi.finishInvestigation).mockResolvedValue(undefined);
    useInvestigationStore.setState({ investigation: { ...investigation, phase: "on_site", draftVerdict: "false_positive" } });
    renderWithToasts(<InvestigateCard />);
    expect(screen.getByText("FALSE")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(investigationApi.finishInvestigation).toHaveBeenCalled();
    expect(await screen.findByText("Recorded as FALSE")).toBeInTheDocument();
  });
});
