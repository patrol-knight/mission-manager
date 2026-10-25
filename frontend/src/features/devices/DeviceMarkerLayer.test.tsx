import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MapContext } from "../map/MapContext";
import { DeviceInspectorProvider } from "./DeviceInspectorProvider";
import { useDeviceInspector } from "./useDeviceInspector";
import { DeviceMarkerLayer } from "./DeviceMarkerLayer";
import { useDeviceStore } from "../../stores/deviceStore";
import type { Device } from "../../types/domain";

const { FakeMarker } = vi.hoisted(() => {
  class FakeMarker {
    static instances: FakeMarker[] = [];
    element: HTMLElement;
    lngLat: [number, number] | null = null;
    removed = false;

    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
      FakeMarker.instances.push(this);
    }
    addTo() {
      return this;
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    setDraggable() {
      return this;
    }
    setRotation() {
      return this;
    }
    getElement() {
      return this.element;
    }
    on() {
      return this;
    }
    remove() {
      this.removed = true;
      return this;
    }
  }
  return { FakeMarker };
});

vi.mock("maplibre-gl", () => ({
  Marker: FakeMarker,
}));

// Per-device connectivity only; the backend-disconnected case is in connectivity.test.ts.
vi.mock("../../hooks/useApiConnection", () => ({
  useApiConnection: () => ({ status: "connected" }),
}));

const robot: Device = {
  deviceId: "sim-robot-01",
  name: "Robot 1",
  type: "robot",
  pose: { frameId: "map", x: 0, y: 0, yaw: 0, lat: 0, lon: 0 },
  timestamp: 0,
  battery: 95,
  speed: 0,
  status: {},
  capabilities: [],
  connected: true,
  lastSeen: 0,
};

const iotDevice: Device = {
  deviceId: "sim-iot-01",
  name: "IoT 1",
  type: "iot",
  pose: { frameId: "map", x: 1, y: 1, yaw: 0, lat: 1, lon: 1 },
  timestamp: 0,
  battery: 80,
  speed: null,
  status: {},
  capabilities: [],
  connected: true,
  lastSeen: 0,
};

function InspectorProbe() {
  const { inspectorOpen, selectedDeviceId } = useDeviceInspector();
  return <div>inspector={inspectorOpen ? selectedDeviceId : "closed"}</div>;
}

function Harness() {
  return (
    <MapContext.Provider value={{ map: {} as never, ready: true }}>
      <DeviceInspectorProvider>
        <DeviceMarkerLayer />
        <InspectorProbe />
      </DeviceInspectorProvider>
    </MapContext.Provider>
  );
}

describe("DeviceMarkerLayer", () => {
  beforeEach(() => {
    FakeMarker.instances = [];
    useDeviceStore.getState().setDevices([robot, iotDevice]);
  });

  it("shows every device and opens the inspector on click", async () => {
    render(<Harness />);
    await vi.waitFor(() => expect(FakeMarker.instances).toHaveLength(2));

    const robotMarker = FakeMarker.instances.find((m) => m.element.dataset.hint === "Robot 1 · Click to view camera");
    robotMarker!.element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.waitFor(() => expect(document.body.textContent).toContain("inspector=sim-robot-01"));
  });

  it("dims and desaturates a disconnected device's marker without removing it", async () => {
    useDeviceStore.getState().setDevices([robot, { ...iotDevice, connected: false }]);
    render(<Harness />);
    await vi.waitFor(() => expect(FakeMarker.instances).toHaveLength(2));

    const robotMarker = FakeMarker.instances.find((m) => m.element.dataset.hint === "Robot 1 · Click to view camera");
    const iotMarker = FakeMarker.instances.find((m) => m.element.dataset.hint === "IoT 1 · Disconnected");

    expect(iotMarker).toBeDefined();
    expect(iotMarker!.element.style.opacity).toBe("0.45");
    expect(iotMarker!.element.style.filter).toBe("grayscale(1)");

    expect(robotMarker!.element.style.opacity).toBe("1");
    expect(robotMarker!.element.style.filter).toBe("none");
  });
});
