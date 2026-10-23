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
  /** WebRTC offer/ICE relayed from a device's gateway. */
  "camera.signal": RawCameraSignal;
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
 * adapter from its raw payload. Where the backend tells two cases apart that
 * the app treats alike (created/updated, snapshot/update), both feed one event. */
const ROUTES: Record<string, Route> = {
  "devices.snapshot": route("devices.snapshot", (d) => (d as RawDevice[]).map(deviceFromRaw)),
  "device.updated": route("device.updated", (d) => deviceFromRaw(d as RawDevice)),
  "mission.current": route("mission.current", (d) => (d ? missionDefinitionFromRaw(d as RawMission) : null)),
  "mission.execution": route("mission.execution", (d) =>
    d ? missionExecutionStateFromRaw(d as RawMissionExecutionState) : null,
  ),
  "mission.execution.updated": route("mission.execution", (d) =>
    d ? missionExecutionStateFromRaw(d as RawMissionExecutionState) : null,
  ),
  "anomalies.snapshot": route("anomalies.snapshot", (d) => (d as RawAnomaly[]).map(anomalyFromRaw)),
  "anomaly.created": route("anomaly.updated", (d) => anomalyFromRaw(d as RawAnomaly)),
  "anomaly.updated": route("anomaly.updated", (d) => anomalyFromRaw(d as RawAnomaly)),
  "anomaly.expired": route("anomaly.expired", (d) => (d as RawAnomalyExpired).anomaly_id),
  "investigation.updated": route("investigation.updated", (d) =>
    d ? investigationFromRaw(d as RawInvestigation) : null,
  ),
  "autonomy.aborted": route("autonomy.aborted", (d) => d as RawAutonomyAborted),
  "cameras.snapshot": route("cameras.snapshot", (d) => (d as RawCameraState[]).map(cameraStateFromRaw)),
  "camera.updated": route("camera.updated", (d) => cameraStateFromRaw(d as RawCameraState)),
  "camera.signal": route("camera.signal", (d) => d as RawCameraSignal),
};

const BASE_DELAY = 2_000;
const MAX_DELAY = 30_000;

/**
 * Typed pub/sub wrapper around the backend's single /ws channel. Consumers
 * subscribe with `on(event, fn)` and get app-shaped (camelCase) payloads;
 * unknown wire types are ignored, so the backend can add events freely.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private retryDelay = BASE_DELAY;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
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

  send(msg: { type: "ping" } | { type: "camera.signal"; data: RawCameraSignal }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
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
    };

    ws.onmessage = (ev) => {
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
      if (this.destroyed) return;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  private dispatch(msg: WsEnvelope): void {
    const target = ROUTES[msg.type];
    if (!target) return; // connection.ready, pong, or a type this app doesn't use
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
