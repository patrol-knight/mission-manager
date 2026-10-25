import type { components } from "../api/schema";
export type DeviceType = "robot" | "iot";

export interface Pose2D {
  frameId: string;
  x: number;
  y: number;
  yaw: number;
  /** Computed once server-side (backend/models/device.py::Pose2D.lat/lon) --
   * null only when the map service was unavailable at ingest time. Lets map
   * layers render a device marker with no per-marker xy-to-lnglat call. */
  lat: number | null;
  lon: number | null;
}

/** App-facing device shape (camelCase). Built from RawDevice via deviceFromRaw. */
export interface Device {
  deviceId: string;
  name: string | null;
  type: DeviceType;
  pose: Pose2D;
  timestamp: number;
  battery: number | null;
  speed: number | null;
  status: Record<string, unknown>;
  capabilities: string[];
  connected: boolean;
  lastSeen: number;
}

export type RawDevice = components["schemas"]["DeviceView"];

export function deviceFromRaw(raw: RawDevice): Device {
  return {
    deviceId: raw.device_id,
    name: raw.name,
    type: raw.type,
    pose: {
      frameId: raw.pose.frame_id,
      x: raw.pose.x,
      y: raw.pose.y,
      yaw: raw.pose.yaw,
      lat: raw.pose.lat,
      lon: raw.pose.lon,
    },
    timestamp: raw.timestamp,
    battery: raw.battery,
    speed: raw.speed,
    status: raw.status,
    capabilities: raw.capabilities,
    connected: raw.connected,
    lastSeen: raw.last_seen,
  };
}

export type CameraStreamStatus = "idle" | "connecting" | "live" | "no_signal" | "offline" | "error";
/** The gateway's session lifecycle -- see backend/models/camera.py. */
export type CameraSessionState = "idle" | "starting" | "negotiating" | "streaming" | "stopping";
/** Whether the gateway is sending real camera frames or its NO SIGNAL placeholder. */
export type CameraVideoSource = "live" | "no_signal";

/** A device's one camera, as the inspector/verify UI sees it -- every
 * device has exactly one camera slot, so there's no id/name to pick by.
 * `status` is the summary the badge shows; `detail` explains an error. */
export interface CameraInfo {
  status: CameraStreamStatus;
  sessionState?: CameraSessionState;
  videoSource?: CameraVideoSource | null;
  detail?: string | null;
}

/** Wire shape pushed over WS as `camera.updated` -- see backend/models/camera.py::CameraState. */
export interface RawCameraState {
  device_id: string;
  camera_id: string;
  stream_state: CameraStreamStatus;
  failure_reason: string | null;
  timestamp: string;
  /** Only in `camera.session.updated` (to the session's owner); null in the public `camera.updated`. */
  session_id: string | null;
  session_state: CameraSessionState;
  video_source: CameraVideoSource | null;
  failure_code: string | null;
  instance_id: string;
  revision: number;
}

/** App-facing camera state (camelCase). Built from RawCameraState via cameraStateFromRaw. */
export interface CameraState {
  deviceId: string;
  cameraId: string;
  streamState: CameraStreamStatus;
  failureReason: string | null;
  timestamp: string;
  sessionId: string | null;
  sessionState: CameraSessionState;
  videoSource: CameraVideoSource | null;
  failureCode: string | null;
}

export function cameraStateFromRaw(raw: RawCameraState): CameraState {
  return {
    deviceId: raw.device_id,
    cameraId: raw.camera_id,
    streamState: raw.stream_state,
    failureReason: raw.failure_reason,
    timestamp: raw.timestamp,
    sessionId: raw.session_id ?? null,
    sessionState: raw.session_state ?? "idle",
    videoSource: raw.video_source ?? null,
    failureCode: raw.failure_code ?? null,
  };
}
