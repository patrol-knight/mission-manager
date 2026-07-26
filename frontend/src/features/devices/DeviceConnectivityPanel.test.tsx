import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeviceInspectorProvider } from "./DeviceInspectorProvider";
import { DeviceConnectivityPanel } from "./DeviceConnectivityPanel";
import { useDeviceStore } from "../../stores/deviceStore";
import type { Device } from "../../types/domain";
import type { ConnectionStatus } from "../../types/ws";

const { mockStatus } = vi.hoisted(() => ({ mockStatus: { current: "connected" as ConnectionStatus } }));

vi.mock("../../hooks/useApiConnection", () => ({
  useApiConnection: () => ({ status: mockStatus.current }),
}));

const connectedDevice: Device = {
  deviceId: "sim-robot-01",
  name: "Robot 1",
  type: "robot",
  pose: { frameId: "map", x: 0, y: 0, yaw: 0, lat: 37.0, lon: -122.0 },
  timestamp: 0,
  battery: 95,
  speed: 0,
  status: {},
  capabilities: [],
  connected: true,
  lastSeen: 0,
};

const disconnectedDevice: Device = {
  ...connectedDevice,
  deviceId: "sim-iot-01",
  name: "IoT 1",
  connected: false,
};

function Harness() {
  return (
    <DeviceInspectorProvider>
      <DeviceConnectivityPanel />
    </DeviceInspectorProvider>
  );
}

describe("DeviceConnectivityPanel", () => {
  beforeEach(() => {
    mockStatus.current = "connected";
    useDeviceStore.getState().setDevices([connectedDevice, disconnectedDevice]);
  });

  it("shows a device's own connected/disconnected status when the backend is reachable", () => {
    render(<Harness />);
    expect(screen.getByLabelText("connected")).toBeInTheDocument();
    expect(screen.getByLabelText("disconnected")).toBeInTheDocument();
  });

  it("shows an 'unknown' status for every device when the backend itself is unreachable, not stale green", () => {
    mockStatus.current = "disconnected";
    render(<Harness />);
    expect(screen.queryByLabelText("connected")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("disconnected")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("unknown (backend disconnected)")).toHaveLength(2);
  });
});
