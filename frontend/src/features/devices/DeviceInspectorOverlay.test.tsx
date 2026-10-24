import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeviceInspectorProvider } from "./DeviceInspectorProvider";
import { DeviceInspectorOverlay } from "./DeviceInspectorOverlay";
import { useDeviceInspector } from "./useDeviceInspector";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import type { Device } from "../../types/domain";

const fakeDevice: Device = {
  deviceId: "sim-robot-01",
  name: "Robot 1",
  type: "robot",
  pose: { frameId: "map", x: 0, y: 0, yaw: 0, lat: 37.0, lon: -122.0 },
  timestamp: 0,
  battery: 80,
  speed: 0,
  status: {},
  capabilities: [],
  connected: true,
  lastSeen: 0,
};

function OpenButton() {
  const { openInspector } = useDeviceInspector();
  return <button onClick={() => openInspector("sim-robot-01")}>Open</button>;
}

function Harness() {
  return (
    <DeviceInspectorProvider>
      <OpenButton />
      <DeviceInspectorOverlay />
    </DeviceInspectorProvider>
  );
}

describe("DeviceInspectorOverlay", () => {
  beforeEach(() => {
    useDeviceStore.getState().setDevices([fakeDevice]);
  });

  it("renders nothing when closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on request and shows the device name", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Robot 1")).toBeInTheDocument();
  });

  it("moves focus into the dialog on open", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
  });

  it("closes when the verify window opens, and closes it when opened itself", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    act(() => useInvestigationStore.getState().openVerify());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Open"));
    expect(useInvestigationStore.getState().verifyOpen).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not close when clicking the dimmed background", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog.parentElement!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("returns focus to the triggering element on close", async () => {
    render(<Harness />);
    const openButton = screen.getByText("Open");
    await userEvent.click(openButton);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(openButton).toHaveFocus());
  });

  it("shows an empty camera state when the device has no camera capability", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByText("Open"));
    expect(await screen.findByText(/no camera available/i)).toBeInTheDocument();
  });
});
