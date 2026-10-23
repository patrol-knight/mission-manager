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
    client.on("devices.snapshot", (devices) => snapshots.push(devices));

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

  it("forwards anomaly.expired as the expired anomaly's id", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const expired: unknown[] = [];
    client.on("anomaly.expired", (anomalyId) => expired.push(anomalyId));
    socket.emitMessage({ type: "anomaly.expired", data: { anomaly_id: "a-1" } });

    expect(expired).toEqual(["a-1"]);
  });

  it("forwards investigation.updated and autonomy.aborted", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const updates: unknown[] = [];
    const aborted: unknown[] = [];
    client.on("investigation.updated", (data) => updates.push(data));
    client.on("autonomy.aborted", (data) => aborted.push(data));
    socket.emitMessage({ type: "investigation.updated", data: null });
    socket.emitMessage({ type: "autonomy.aborted", data: { reason: "robot_disconnected", anomaly_id: "a-1" } });

    expect(updates).toEqual([null]);
    expect(aborted).toEqual([{ reason: "robot_disconnected", anomaly_id: "a-1" }]);
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

  it("feeds mission.execution and mission.execution.updated to one event, adapted to camelCase", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    const states: unknown[] = [];
    client.on("mission.execution", (state) => states.push(state));
    const raw = {
      mission_id: "m-1",
      status: "running",
      current_loop: 1,
      completed_loops: 0,
      current_waypoint_index: 2,
      updated_at: null,
    };
    socket.emitMessage({ type: "mission.execution", data: raw });
    socket.emitMessage({ type: "mission.execution.updated", data: null });

    expect(states).toEqual([
      {
        missionId: "m-1",
        status: "running",
        currentLoop: 1,
        completedLoops: 0,
        currentWaypointIndex: 2,
        updatedAt: null,
      },
      null,
    ]);
  });

  it("ignores unknown/forward-compatible event types without throwing", async () => {
    const { getRealtimeClient } = await import("./realtimeClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    expect(() => socket.emitMessage({ type: "some.future.event", data: {} })).not.toThrow();
  });
});
