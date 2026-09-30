export type DeviceType = "robot" | "iot";
export type ConnectivityStatus = "connected" | "disconnected";

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

/** Wire shape sent by the backend — see backend/models/device.py::DeviceView. */
export interface RawDevice {
  device_id: string;
  name: string | null;
  type: DeviceType;
  pose: { frame_id: string; x: number; y: number; yaw: number; lat: number | null; lon: number | null };
  timestamp: number;
  battery: number | null;
  speed: number | null;
  status: Record<string, unknown>;
  capabilities: string[];
  connected: boolean;
  last_seen: number;
}

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

export function connectivityStatus(device: Pick<Device, "connected">): ConnectivityStatus {
  return device.connected ? "connected" : "disconnected";
}

export type CameraStreamStatus = "idle" | "connecting" | "live" | "no_signal" | "offline" | "error";

/** A device's one camera, as the inspector/verify UI sees it -- every
 * device has exactly one camera slot, so there's no id/name to pick by. */
export interface CameraInfo {
  status: CameraStreamStatus;
}

/** Wire shape pushed over WS as `camera.updated` -- see backend/models/camera.py::CameraState. */
export interface RawCameraState {
  device_id: string;
  camera_id: string;
  stream_state: CameraStreamStatus;
  failure_reason: string | null;
  timestamp: string;
}

/** App-facing camera state (camelCase). Built from RawCameraState via cameraStateFromRaw. */
export interface CameraState {
  deviceId: string;
  cameraId: string;
  streamState: CameraStreamStatus;
  failureReason: string | null;
  timestamp: string;
}

export function cameraStateFromRaw(raw: RawCameraState): CameraState {
  return {
    deviceId: raw.device_id,
    cameraId: raw.camera_id,
    streamState: raw.stream_state,
    failureReason: raw.failure_reason,
    timestamp: raw.timestamp,
  };
}
