export type DeviceType = "robot" | "iot";
export type ConnectivityStatus = "connected" | "disconnected";

export interface Pose2D {
  frameId: string;
  x: number;
  y: number;
  yaw: number;
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
  pose: { frame_id: string; x: number; y: number; yaw: number };
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
    pose: { frameId: raw.pose.frame_id, x: raw.pose.x, y: raw.pose.y, yaw: raw.pose.yaw },
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

export type CameraStreamStatus = "idle" | "connecting" | "live" | "offline" | "error";

export interface CameraInfo {
  id: string;
  name: string;
  status: CameraStreamStatus;
}
