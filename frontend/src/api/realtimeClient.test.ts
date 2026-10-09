import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("realtimeClient", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adapts devices.snapshot and device.updated payloads to camelCase Device objects", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const snapshots: unknown[] = [];
    client.onDevicesSnapshot((devices) => snapshots.push(devices));

    socket.emitMessage({
      type: "devices.snapshot",
      data: [
        {
          device_id: "sim-robot-01",
          name: null,
          type: "robot",
          pose: { frame_id: "map", x: 0, y: 0, yaw: 0 },
          timestamp: 1,
          battery: null,
          speed: null,
          status: {},
          capabilities: [],
          connected: true,
          last_seen: 1,
        },
      ],
    });

    expect(snapshots).toHaveLength(1);
    expect((snapshots[0] as { deviceId: string }[])[0].deviceId).toBe("sim-robot-01");
  });

  it("forwards anomaly.expired payloads to expiry listeners", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const expired: unknown[] = [];
    client.onAnomalyExpired((data) => expired.push(data));
    socket.emitMessage({ type: "anomaly.expired", data: { anomaly_id: "a-1" } });

    expect(expired).toEqual([{ anomaly_id: "a-1" }]);
  });

  it("forwards investigation.updated and investigation.cancelled", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const updates: unknown[] = [];
    const cancelled: unknown[] = [];
    client.onInvestigationUpdate((data) => updates.push(data));
    client.onInvestigationCancelled((data) => cancelled.push(data));
    socket.emitMessage({ type: "investigation.updated", data: null });
    socket.emitMessage({ type: "investigation.cancelled", data: { anomaly_id: "a-1", reason: "robot_disconnected" } });

    expect(updates).toEqual([null]);
    expect(cancelled).toEqual([{ anomaly_id: "a-1", reason: "robot_disconnected" }]);
  });

  it("reports connection status transitions", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];

    const statuses: string[] = [];
    client.onStatus((s) => statuses.push(s));
    socket.emitOpen();
    socket.close();

    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("ignores unknown/forward-compatible event types without throwing", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    expect(() => socket.emitMessage({ type: "mission.execution.updated", data: {} })).not.toThrow();
  });
});
