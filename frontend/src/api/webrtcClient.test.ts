import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Drives webrtcClient through the real realtimeClient over a fake WebSocket,
// with a fake RTCPeerConnection and fetch -- the ordering, filtering and
// cleanup logic is what's under test, not the browser's WebRTC stack.

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: { type: string; data?: Record<string, unknown> }[] = [];

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(type: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, data }) });
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  calls: string[] = [];
  remoteCandidates: string[] = [];
  closed = false;
  connectionState = "new";
  ontrack: ((ev: unknown) => void) | null = null;
  onicecandidate: ((ev: { candidate: { candidate: string; sdpMLineIndex: number } | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  async setRemoteDescription(desc: { type: string; sdp: string }) {
    this.calls.push(`setRemoteDescription:${desc.sdp}`);
  }

  async addIceCandidate(candidate: { candidate: string }) {
    this.calls.push(`addIceCandidate:${candidate.candidate}`);
    this.remoteCandidates.push(candidate.candidate);
  }

  async createAnswer() {
    this.calls.push("createAnswer");
    return { type: "answer", sdp: "answer-sdp" };
  }

  async setLocalDescription() {
    this.calls.push("setLocalDescription");
  }

  close() {
    this.closed = true;
  }
}

const DEVICE = "iot-1";
const CAMERA = "front";

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("webrtcClient", () => {
  let fetchCalls: FetchCall[];
  let fetchResponses: Array<ReturnType<typeof deferred<ReturnType<typeof jsonResponse>>>>;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakePeerConnection.instances = [];
    fetchCalls = [];
    fetchResponses = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("fetch", (url: string, init: { body?: string }) => {
      fetchCalls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
      const response = deferred<ReturnType<typeof jsonResponse>>();
      fetchResponses.push(response);
      return response.promise;
    });
    sessionStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Connects the realtime client and starts a session whose POST is still pending. */
  async function begin(callbacks: Record<string, unknown> = {}) {
    const { getRealtimeClient } = await import("./realtimeClient");
    const webrtc = await import("./webrtcClient");
    const client = getRealtimeClient();
    client.connect();
    const socket = FakeWebSocket.instances[0];
    socket.onopen?.();
    socket.emit("connection.ready", { protocol_version: 2, connection_id: "conn-1" });

    const onTrack = vi.fn();
    const started = webrtc.startWebrtcSession(DEVICE, CAMERA, { onTrack, ...callbacks });
    await flush();
    const pc = FakePeerConnection.instances[0];
    const startCall = fetchCalls[0];
    return { webrtc, client, socket, started, pc, startCall, sessionId: startCall.body.session_id as string };
  }

  function signal(socket: FakeWebSocket, sessionId: string, fields: Record<string, unknown>) {
    socket.emit("camera.signal", { device_id: DEVICE, camera_id: CAMERA, session_id: sessionId, ...fields });
  }

  function sentSignals(socket: FakeWebSocket) {
    return socket.sent.filter((m) => m.type === "camera.signal").map((m) => m.data!);
  }

  it("generates the session id and owns it with the current connection before Start", async () => {
    const { startCall, sessionId } = await begin();
    expect(startCall.url).toContain(`/api/cameras/${DEVICE}/${CAMERA}/stream`);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(startCall.body.connection_id).toBe("conn-1");
  });

  it("answers an offer that arrives before the Start request returns", async () => {
    const { socket, started, pc, sessionId } = await begin();

    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    await flush();
    expect(pc.calls).toEqual(["setRemoteDescription:offer-sdp", "createAnswer", "setLocalDescription"]);
    expect(sentSignals(socket)).toEqual([
      { device_id: DEVICE, camera_id: CAMERA, session_id: sessionId, type: "answer", sdp: "answer-sdp" },
    ]);

    fetchResponses[0].resolve(jsonResponse(201, { session_id: sessionId, session_state: "starting" }));
    const session = await started;
    expect(session.sessionId).toBe(sessionId);
  });

  it("holds ICE candidates until the offer is applied, then applies them in order", async () => {
    const { socket, pc, sessionId } = await begin();
    signal(socket, sessionId, { type: "ice-candidate", candidate: "cand-1", sdp_mline_index: 0 });
    signal(socket, sessionId, { type: "ice-candidate", candidate: "cand-2", sdp_mline_index: 0 });
    await flush();
    expect(pc.calls).toEqual([]);

    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    await flush();
    expect(pc.calls.slice(0, 3)).toEqual([
      "setRemoteDescription:offer-sdp",
      "addIceCandidate:cand-1",
      "addIceCandidate:cand-2",
    ]);
  });

  it("ignores other sessions' signals and duplicates of its own", async () => {
    const { socket, pc, sessionId } = await begin();
    signal(socket, "some-other-session", { type: "offer", sdp: "stale-offer" });
    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    signal(socket, sessionId, { type: "ice-candidate", candidate: "cand-1", sdp_mline_index: 0 });
    signal(socket, sessionId, { type: "ice-candidate", candidate: "cand-1", sdp_mline_index: 0 });
    await flush();
    expect(pc.calls.filter((c) => c.startsWith("setRemoteDescription"))).toEqual(["setRemoteDescription:offer-sdp"]);
    expect(pc.remoteCandidates).toEqual(["cand-1"]);
  });

  it("surfaces a busy camera as a CameraSessionError and cleans up", async () => {
    const { webrtc, socket, started, pc, sessionId } = await begin();
    fetchResponses[0].resolve(jsonResponse(409, { detail: "camera is in use by another viewer", code: "camera_busy" }));
    await expect(started).rejects.toMatchObject({ name: "CameraSessionError", code: "camera_busy", status: 409 });
    expect(pc.closed).toBe(true);
    expect(webrtc.describeCameraSessionError("camera_busy")).toMatch(/another viewer/);

    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    await flush();
    expect(pc.calls).toEqual([]);
  });

  it("stop() closes the connection, posts a session-scoped Stop and ignores later signals", async () => {
    const { socket, started, pc, sessionId } = await begin();
    fetchResponses[0].resolve(jsonResponse(201, { session_id: sessionId }));
    const session = await started;
    expect(JSON.parse(sessionStorage.getItem("camera.activeSession")!).sessionId).toBe(sessionId);

    const stopping = session.stop();
    await flush();
    expect(pc.closed).toBe(true);
    expect(fetchCalls[1].url).toContain(`/stream/${sessionId}/stop`);
    expect(fetchCalls[1].body).toEqual({ connection_id: "conn-1" });
    fetchResponses[1].resolve(jsonResponse(204, undefined));
    await stopping;
    expect(sessionStorage.getItem("camera.activeSession")).toBeNull();

    signal(socket, sessionId, { type: "offer", sdp: "offer-sdp" });
    await flush();
    expect(pc.calls).toEqual([]);
  });

  it("resumes on a new WebSocket and sends what it couldn't send meanwhile", async () => {
    const { client, socket, started, pc, sessionId } = await begin();
    fetchResponses[0].resolve(jsonResponse(201, { session_id: sessionId }));
    await started;

    vi.useFakeTimers();
    socket.close(); // WebSocket drops; the RTCPeerConnection lives on
    expect(client.getConnectionId()).toBeNull();
    pc.onicecandidate?.({ candidate: { candidate: "local-cand", sdpMLineIndex: 0 } });
    expect(sentSignals(socket)).toEqual([]); // not sent into a closed socket...

    vi.advanceTimersByTime(2_000); // ...the client's reconnect backoff
    vi.useRealTimers();
    const next = FakeWebSocket.instances[1];
    next.onopen?.();
    next.emit("connection.ready", { protocol_version: 2, connection_id: "conn-2" });
    expect(next.sent).toEqual([
      { type: "camera.session.resume", data: { session_id: sessionId, previous_connection_id: "conn-1" } },
    ]);

    next.emit("camera.session.resumed", { session_id: sessionId });
    expect(sentSignals(next)).toEqual([
      {
        device_id: DEVICE,
        camera_id: CAMERA,
        session_id: sessionId,
        type: "ice-candidate",
        candidate: "local-cand",
        sdp_mline_index: 0,
      },
    ]);
  });

  it("ends the session when the backend says it ended", async () => {
    const onEnded = vi.fn();
    const { socket, started, pc, sessionId } = await begin({ onEnded });
    fetchResponses[0].resolve(jsonResponse(201, { session_id: sessionId }));
    await started;

    socket.emit("camera.session.ended", { session_id: "another", reason: "stopped" });
    expect(onEnded).not.toHaveBeenCalled();
    socket.emit("camera.session.ended", {
      device_id: DEVICE,
      camera_id: CAMERA,
      session_id: sessionId,
      reason: "ended",
      failure_code: "negotiation_timeout",
      failure_reason: null,
    });
    expect(onEnded).toHaveBeenCalledWith("negotiation_timeout");
    expect(pc.closed).toBe(true);
  });

  it("releases a session a previous page load left behind, without reusing its id", async () => {
    sessionStorage.setItem(
      "camera.activeSession",
      JSON.stringify({ deviceId: DEVICE, cameraId: CAMERA, sessionId: "old-session", connectionId: "old-conn" }),
    );
    const { releaseAbandonedSession } = await import("./webrtcClient");
    releaseAbandonedSession();
    expect(fetchCalls).toEqual([
      {
        url: expect.stringContaining(`/stream/old-session/stop`),
        body: { connection_id: "old-conn" },
      },
    ]);
    expect(sessionStorage.getItem("camera.activeSession")).toBeNull();
  });
});
