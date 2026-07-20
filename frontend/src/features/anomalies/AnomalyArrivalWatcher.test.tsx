import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "../../components/Toast";
import { DeviceInspectorProvider } from "../devices/DeviceInspectorProvider";
import { useDeviceInspector } from "../devices/useDeviceInspector";
import { AnomalyArrivalWatcher } from "./AnomalyArrivalWatcher";
import { useDeviceStore } from "../../stores/deviceStore";
import type { Anomaly } from "./anomalyTypes";

const anomaly: Anomaly = {
  anomalyId: "sim-anomaly-1",
  x: 1,
  y: 2,
  frameId: "map",
  status: "robot_en_route",
  detectedAt: "2026-07-19T00:00:00Z",
  updatedAt: "2026-07-19T00:00:00Z",
  sourceDeviceId: "sim-robot-01",
  description: null,
};

function InspectorProbe() {
  const { inspectorOpen, selectedDeviceId, anomalyContext } = useDeviceInspector();
  if (!inspectorOpen) return <div>inspector-closed</div>;
  return (
    <div>
      inspector-open for {selectedDeviceId} anomaly={anomalyContext}
    </div>
  );
}

function Harness() {
  return (
    <ToastProvider>
      <DeviceInspectorProvider>
        <AnomalyArrivalWatcher />
        <InspectorProbe />
      </DeviceInspectorProvider>
    </ToastProvider>
  );
}

describe("AnomalyArrivalWatcher", () => {
  beforeEach(() => {
    useDeviceStore.setState({ anomalies: {} });
  });

  it("shows nothing while the anomaly is only en_route", () => {
    useDeviceStore.getState().upsertAnomaly(anomaly);
    render(<Harness />);
    expect(screen.queryByText(/robot arrived/i)).not.toBeInTheDocument();
  });

  it("shows a persistent arrival toast once the anomaly reaches robot_arrived", () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    expect(screen.getByText(/robot arrived at anomaly location/i)).toBeInTheDocument();
    expect(screen.getByText("Open Robot Inspector")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("does not show a second toast for the same anomaly on further updates", () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    act(() =>
      useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived", description: "still here" }),
    );
    expect(screen.getAllByText(/robot arrived at anomaly location/i)).toHaveLength(1);
  });

  it("opens the inspector with anomaly context when 'Open Robot Inspector' is clicked", async () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    await userEvent.click(screen.getByText("Open Robot Inspector"));
    expect(screen.getByText(/inspector-open for sim-robot-01 anomaly=sim-anomaly-1/)).toBeInTheDocument();
    expect(screen.queryByText(/robot arrived at anomaly location/i)).not.toBeInTheDocument();
  });

  it("dismisses the toast without opening the inspector when 'Dismiss' is clicked", async () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    await userEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByText(/robot arrived at anomaly location/i)).not.toBeInTheDocument();
    expect(screen.getByText("inspector-closed")).toBeInTheDocument();
  });
});
