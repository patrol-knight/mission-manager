import { WS_URL } from "./config";
import {
  cameraStateFromRaw,
  deviceFromRaw,
  type CameraState,
  type Device,
  type RawCameraState,
  type RawDevice,
} from "../types/domain";
import {
  missionDefinitionFromRaw,
  missionExecutionStateFromRaw,
  type MissionDefinition,
  type MissionExecutionState,
  type RawMission,
  type RawMissionExecutionState,
} from "../features/missions/missionTypes";
import { anomalyFromRaw, type Anomaly, type RawAnomaly, type RawAnomalyExpired } from "../features/anomalies/anomalyTypes";
import {
  investigationFromRaw,
  type Investigation,
  type RawAutonomyAborted,
  type RawInvestigation,
} from "../features/investigation/investigationTypes";
import type { ConnectionStatus, WsEnvelope } from "../types/ws";

/** Wire shape of a `camera.signal` message's `data` -- see
 * backend/transport/zenoh_gateway.py::ingest_camera_signal_payload and
 * backend/models/camera.py::WebRtcSignal. */
export interface RawCameraSignal {
  device_id: string;
  camera_id: string;
  session_id: string;
  type: "offer" | "answer" | "ice-candidate";
  sdp?: string | null;
  candidate?: string | null;
  sdp_mline_index?: number | null;
}

/** `camera.session.ended` -- the backend forgot the session (stopped, ended
 * by the gateway, or the gateway restarted). */
export interface CameraSessionEnded {
  device_id: string;
  camera_id: string;
  session_id: string;
  reason: string;
  failure_code: string | null;
  failure_reason: string | null;
}

/** Replies about one camera session: `camera.signal.rejected`,
 * `camera.session.resumed`, `camera.session.resume_failed`. */
export interface CameraSessionReply {
  session_id: string;
  code?: string;
}

export type CameraSessionReplyKind = "signal_rejected" | "resumed" | "resume_failed";

type OutboundMessage =
  | { type: "ping" }
  | { type: "camera.signal"; data: RawCameraSignal }
  | { type: "camera.session.resume"; data: { session_id: string; previous_connection_id: string | null } };

/** Every event the app can subscribe to, with its already-adapted payload. */
export interface RealtimeEvents {
  "devices.snapshot": Device[];
  "device.updated": Device;
  /** The current mission's *definition*; null when none is set. */
  "mission.current": MissionDefinition | null;
  /** Execution progress (connect snapshot and every update); null when no mission is current. */
  "mission.execution": MissionExecutionState | null;
  "anomalies.snapshot": Anomaly[];
  /** A new anomaly, or a refresh/verdict on a known one. */
  "anomaly.updated": Anomaly;
  /** Id of an anomaly whose grace period ran out without a refresh. */
  "anomaly.expired": string;
  /** The full investigation state, or null when none is active. */
  "investigation.updated": Investigation | null;
  /** Mission and investigation were stopped, e.g. the robot was lost. */
  "autonomy.aborted": RawAutonomyAborted;
  "cameras.snapshot": CameraState[];
  /** A camera's stream_state changed (idle/connecting/live/no_signal/offline/error). */
  "camera.updated": CameraState;
  /** WebRTC offer/ICE from the device's gateway, for a session this connection owns. */
  "camera.signal": RawCameraSignal;
  /** The full camera state, sent only to the owner of the session it names. */
  "camera.session.updated": CameraState;
  "camera.session.ended": CameraSessionEnded;
  "camera.session.reply": { kind: CameraSessionReplyKind; reply: CameraSessionReply };
  /** Once per (re)connection, with the id the backend gave it. */
  "connection.ready": string;
}

export type RealtimeEvent = keyof RealtimeEvents;

type Unsubscribe = () => void;
type Listener<T> = (payload: T) => void;

interface Route {
  event: RealtimeEvent;
  parse: (data: unknown) => unknown;
}

function route<K extends RealtimeEvent>(event: K, parse: (data: unknown) => RealtimeEvents[K]): Route {
  return { event, parse };
}

/** Wire message type (backend/api/websocket.py) -> the event it feeds and the
 * adapter from its raw payload. */
const ROUTES: Record<string, Route> = {
  "devices.snapshot": route("devices.snapshot", (d) => (d as RawDevice[]).map(deviceFromRaw)),
  "device.updated": route("device.updated", (d) => deviceFromRaw(d as RawDevice)),
  "mission.current": route("mission.current", (d) => (d ? missionDefinitionFromRaw(d as RawMission) : null)),
  "mission.execution": route("mission.execution", (d) =>
    d ? missionExecutionStateFromRaw(d as RawMissionExecutionState) : null,
  ),
  "anomalies.snapshot": route("anomalies.snapshot", (d) => (d as RawAnomaly[]).map(anomalyFromRaw)),
  "anomaly.updated": route("anomaly.updated", (d) => anomalyFromRaw(d as RawAnomaly)),
  "anomaly.expired": route("anomaly.expired", (d) => (d as RawAnomalyExpired).anomaly_id),
  "connection.ready": route("connection.ready", (d) => d as string),
  "investigation.updated": route("investigation.updated", (d) =>
    d ? investigationFromRaw(d as RawInvestigation) : null,
  ),
  "autonomy.aborted": route("autonomy.aborted", (d) => d as RawAutonomyAborted),
  "cameras.snapshot": route("cameras.snapshot", (d) => (d as RawCameraState[]).map(cameraStateFromRaw)),
  "camera.updated": route("camera.updated", (d) => cameraStateFromRaw(d as RawCameraState)),
  "camera.signal": route("camera.signal", (d) => d as RawCameraSignal),
  "camera.session.updated": route("camera.session.updated", (d) => cameraStateFromRaw(d as RawCameraState)),
  "camera.session.ended": route("camera.session.ended", (d) => d as CameraSessionEnded),
  "camera.signal.rejected": route("camera.session.reply", (d) => ({ kind: "signal_rejected", reply: d as CameraSessionReply })),
  "camera.session.resumed": route("camera.session.reply", (d) => ({ kind: "resumed", reply: d as CameraSessionReply })),
  "camera.session.resume_failed": route("camera.session.reply", (d) => ({
    kind: "resume_failed",
    reply: d as CameraSessionReply,
  })),
};

const BASE_DELAY = 2_000;
const MAX_DELAY = 30_000;
/** Ping this often; a connection silent for HEARTBEAT_TIMEOUT is treated as dead. */
const HEARTBEAT_INTERVAL = 15_000;
const HEARTBEAT_TIMEOUT = 40_000;

/**
 * Typed pub/sub wrapper around the backend's single /ws channel. Consumers
 * subscribe with `on(event, fn)` and get app-shaped (camelCase) payloads;
 * unknown wire types are ignored, so the backend can add events freely.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private retryDelay = BASE_DELAY;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  /** From the latest connection.ready; null while (re)connecting. */
  private connectionId: string | null = null;
  private destroyed = false;
  private status: ConnectionStatus = "connecting";

  private statusListeners = new Set<Listener<ConnectionStatus>>();
  private listeners = new Map<RealtimeEvent, Set<Listener<unknown>>>();

  connect(): void {
    if (this.ws || this.destroyed) return;
    this.open();
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  /** Calls `fn` with the current status right away, then on every change. */
  onStatus(fn: Listener<ConnectionStatus>): Unsubscribe {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  on<K extends RealtimeEvent>(event: K, fn: Listener<RealtimeEvents[K]>): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<unknown>);
    return () => set.delete(fn as Listener<unknown>);
  }

  /** The current connection's id (it identifies a camera session's owner), or null while disconnected. */
  getConnectionId(): string | null {
    return this.connectionId;
  }

  /** Resolves with the connection id once connected; rejects after `timeoutMs`. */
  waitForConnection(timeoutMs: number): Promise<string> {
    if (this.connectionId) return Promise.resolve(this.connectionId);
    this.connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("realtime connection not available"));
      }, timeoutMs);
      const unsubscribe = this.on("connection.ready", (id) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(id);
      });
    });
  }

  /** True if the message went out; false if the socket isn't open (nothing is queued here). */
  send(msg: OutboundMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private open(): void {
    if (this.destroyed) return;

    this.setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = BASE_DELAY;
      this.setStatus("connected");
      this.startHeartbeat(ws);
    };

    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      let msg: WsEnvelope;
      try {
        msg = JSON.parse(ev.data as string) as WsEnvelope;
      } catch {
        console.warn("[realtime] Failed to parse message:", ev.data);
        return;
      }
      this.dispatch(msg);
    };

    ws.onerror = () => {
      // onerror is always followed by onclose; handle reconnection there.
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.connectionId = null;
      if (this.destroyed) return;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  /** A half-open connection (e.g. the network dropped) never fires onclose
   * by itself; closing it on silence lets the reconnect loop take over. */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.lastMessageAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT) {
        // Don't wait for close() to complete on a dead link: reconnect now.
        ws.onclose = null;
        ws.close();
        this.stopHeartbeat();
        this.ws = null;
        this.connectionId = null;
        this.setStatus("disconnected");
        this.scheduleReconnect();
        return;
      }
      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private dispatch(msg: WsEnvelope): void {
    if (msg.type === "connection.ready") {
      const id = (msg.data as { connection_id?: unknown } | null)?.connection_id;
      if (typeof id !== "string") return;
      this.connectionId = id;
      msg = { ...msg, data: id };
    }
    const target = ROUTES[msg.type];
    if (!target) return; // pong, or a type this app doesn't use
    const listeners = this.listeners.get(target.event);
    if (!listeners || listeners.size === 0) return;
    const payload = target.parse(msg.data);
    listeners.forEach((fn) => fn(payload));
  }

  private scheduleReconnect(): void {
    if (this.retryTimer || this.destroyed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_DELAY);
      this.open();
    }, this.retryDelay);
  }
}

// Singleton — one realtime connection for the whole app lifetime.
let instance: RealtimeClient | null = null;

export function getRealtimeClient(): RealtimeClient {
  if (!instance) instance = new RealtimeClient();
  return instance;
}

export type { RealtimeClient };
