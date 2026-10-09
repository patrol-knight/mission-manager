import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { AnomalyArrivalWatcher } from "./AnomalyArrivalWatcher";
import { useDeviceStore } from "../../stores/deviceStore";
import type { Anomaly } from "./anomalyTypes";

const anomaly: Anomaly = {
  anomalyId: "sim-anomaly-1",
  types: ["lying_down"],
  x: 1,
  y: 2,
  frameId: "map",
  confidence: 0.9,
  sourceDeviceId: "iot-01",
  status: "robot_en_route",
  detectedAt: "2026-07-19T00:00:00Z",
  updatedAt: "2026-07-19T00:00:00Z",
  lastSeenAt: "2026-07-19T00:00:00Z",
  degradeSec: 30,
  expiresAt: "2026-07-19T00:00:30Z",
  lat: 37.0,
  lon: -122.0,
  resolution: null,
  resolvedAt: null,
  missionId: null,
};

function Harness() {
  return (
    <ToastProvider>
      <AnomalyArrivalWatcher />
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

  it("shows a one-time informational toast once the anomaly reaches robot_arrived", () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    expect(screen.getByText(/robot arrived at anomaly location\. verify it\./i)).toBeInTheDocument();
  });

  it("does not show a second toast for the same anomaly on further updates", () => {
    render(<Harness />);
    act(() => useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived" }));
    act(() =>
      useDeviceStore.getState().upsertAnomaly({ ...anomaly, status: "robot_arrived", confidence: 0.95 }),
    );
    expect(screen.getAllByText(/robot arrived at anomaly location/i)).toHaveLength(1);
  });
});
