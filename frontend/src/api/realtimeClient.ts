import { WS_URL } from "./config";
import {
  cameraStateFromRaw,
  deviceFromRaw,
  type CameraState,
  type Device,
  type RawCameraState,
  type RawDevice,
} from "../types/domain";
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

type Unsubscribe = () => void;
type Listener<T> = (payload: T) => void;

const BASE_DELAY = 2_000;
const MAX_DELAY = 30_000;

/**
 * Typed pub/sub wrapper around the backend's single /ws channel — see
 * backend/api/websocket.py for the protocol. `onMissionUpdate`/`onMissionExecutionUpdate`/
 * `onAnomalySnapshot`/`onAnomalyUpdate` are wired up front so consumers (missionStore,
 * deviceStore) have a stable subscription surface; the underlying `mission.execution.updated`
 * and `anomaly.*` events simply won't fire until the backend milestones that emit them
 * (B2/B3) land — that's a no-op, not an error, until then.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private retryDelay = BASE_DELAY;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private status: ConnectionStatus = "connecting";

  private statusListeners = new Set<Listener<ConnectionStatus>>();
  private devicesSnapshotListeners = new Set<Listener<Device[]>>();
  private deviceUpdateListeners = new Set<Listener<Device>>();
  private missionUpdateListeners = new Set<Listener<unknown>>();
  private missionExecutionListeners = new Set<Listener<unknown>>();
  private anomalySnapshotListeners = new Set<Listener<unknown[]>>();
  private anomalyUpdateListeners = new Set<Listener<unknown>>();
  private anomalyExpiredListeners = new Set<Listener<unknown>>();
  private diversionStartedListeners = new Set<Listener<unknown>>();
  private diversionReturningListeners = new Set<Listener<unknown>>();
  private diversionClearedListeners = new Set<Listener<unknown>>();
  private cameraUpdateListeners = new Set<Listener<CameraState>>();
  private camerasSnapshotListeners = new Set<Listener<CameraState[]>>();
  private cameraSignalListeners = new Set<Listener<RawCameraSignal>>();

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

  onStatus(fn: Listener<ConnectionStatus>): Unsubscribe {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  onDevicesSnapshot(fn: Listener<Device[]>): Unsubscribe {
    this.devicesSnapshotListeners.add(fn);
    return () => this.devicesSnapshotListeners.delete(fn);
  }

  onDeviceUpdate(fn: Listener<Device>): Unsubscribe {
    this.deviceUpdateListeners.add(fn);
    return () => this.deviceUpdateListeners.delete(fn);
  }

  /** Fed by `mission.current` — mission *definition* changes, not execution progress. */
  onMissionUpdate(fn: Listener<unknown>): Unsubscribe {
    this.missionUpdateListeners.add(fn);
    return () => this.missionUpdateListeners.delete(fn);
  }

  /** Fed by `mission.execution`/`mission.execution.updated` (added in backend milestone B2). */
  onMissionExecutionUpdate(fn: Listener<unknown>): Unsubscribe {
    this.missionExecutionListeners.add(fn);
    return () => this.missionExecutionListeners.delete(fn);
  }

  /** Fed by `anomalies.snapshot` (added in backend milestone B3). */
  onAnomalySnapshot(fn: Listener<unknown[]>): Unsubscribe {
    this.anomalySnapshotListeners.add(fn);
    return () => this.anomalySnapshotListeners.delete(fn);
  }

  /** Fed by `anomaly.created`/`anomaly.updated` (added in backend milestone B3). */
  onAnomalyUpdate(fn: Listener<unknown>): Unsubscribe {
    this.anomalyUpdateListeners.add(fn);
    return () => this.anomalyUpdateListeners.delete(fn);
  }

  /** Fed by `anomaly.expired` — the anomaly's grace period ran out without a refresh. */
  onAnomalyExpired(fn: Listener<unknown>): Unsubscribe {
    this.anomalyExpiredListeners.add(fn);
    return () => this.anomalyExpiredListeners.delete(fn);
  }

  /** Fed by `anomaly.diversion.started` — robot begins diverting to an anomaly. */
  onDiversionStarted(fn: Listener<unknown>): Unsubscribe {
    this.diversionStartedListeners.add(fn);
    return () => this.diversionStartedListeners.delete(fn);
  }

  /** Fed by `anomaly.diversion.returning` — robot heads back to the mission. */
  onDiversionReturning(fn: Listener<unknown>): Unsubscribe {
    this.diversionReturningListeners.add(fn);
    return () => this.diversionReturningListeners.delete(fn);
  }

  /** Fed by `anomaly.diversion.cleared` — diversion fully resolved (or aborted). */
  onDiversionCleared(fn: Listener<unknown>): Unsubscribe {
    this.diversionClearedListeners.add(fn);
    return () => this.diversionClearedListeners.delete(fn);
  }

  /** Fed by `camera.updated` — a camera's stream_state changed (idle/connecting/live/no_signal/offline/error). */
  onCameraUpdate(fn: Listener<CameraState>): Unsubscribe {
    this.cameraUpdateListeners.add(fn);
    return () => this.cameraUpdateListeners.delete(fn);
  }

  /** Fed by `cameras.snapshot` — sent once on connect, mirrors devices.snapshot. */
  onCamerasSnapshot(fn: Listener<CameraState[]>): Unsubscribe {
    this.camerasSnapshotListeners.add(fn);
    return () => this.camerasSnapshotListeners.delete(fn);
  }

  /** Fed by `camera.signal` — WebRTC offer/ICE relayed from the device's gateway. */
  onCameraSignal(fn: Listener<RawCameraSignal>): Unsubscribe {
    this.cameraSignalListeners.add(fn);
    return () => this.cameraSignalListeners.delete(fn);
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
    switch (msg.type) {
      case "devices.snapshot":
        this.devicesSnapshotListeners.forEach((fn) =>
          fn((msg.data as RawDevice[]).map(deviceFromRaw)),
        );
        break;
      case "device.updated":
        this.deviceUpdateListeners.forEach((fn) => fn(deviceFromRaw(msg.data as RawDevice)));
        break;
      case "mission.current":
        this.missionUpdateListeners.forEach((fn) => fn(msg.data));
        break;
      case "mission.execution":
      case "mission.execution.updated":
        this.missionExecutionListeners.forEach((fn) => fn(msg.data));
        break;
      case "anomalies.snapshot":
        this.anomalySnapshotListeners.forEach((fn) => fn(msg.data as unknown[]));
        break;
      case "anomaly.created":
      case "anomaly.updated":
        this.anomalyUpdateListeners.forEach((fn) => fn(msg.data));
        break;
      case "anomaly.expired":
        this.anomalyExpiredListeners.forEach((fn) => fn(msg.data));
        break;
      case "anomaly.diversion.started":
        this.diversionStartedListeners.forEach((fn) => fn(msg.data));
        break;
      case "anomaly.diversion.returning":
        this.diversionReturningListeners.forEach((fn) => fn(msg.data));
        break;
      case "anomaly.diversion.cleared":
        this.diversionClearedListeners.forEach((fn) => fn(msg.data));
        break;
      case "camera.updated":
        this.cameraUpdateListeners.forEach((fn) => fn(cameraStateFromRaw(msg.data as RawCameraState)));
        break;
      case "cameras.snapshot":
        this.camerasSnapshotListeners.forEach((fn) =>
          fn((msg.data as RawCameraState[]).map(cameraStateFromRaw)),
        );
        break;
      case "camera.signal":
        this.cameraSignalListeners.forEach((fn) => fn(msg.data as RawCameraSignal));
        break;
      case "connection.ready":
      case "pong":
        break;
      default:
        // Forward-compatible: unknown event types are ignored rather than treated as errors.
        break;
    }
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
