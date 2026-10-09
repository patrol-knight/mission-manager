import { create } from "zustand";
import type { CameraState, Device } from "../types/domain";
import type { Anomaly } from "../features/anomalies/anomalyTypes";
import {
  NO_DIVERSION,
  type Diversion,
  type RawDiversionReturning,
  type RawDiversionStarted,
} from "../features/anomalies/diversionTypes";

interface DeviceStoreState {
  devices: Record<string, Device>;
  /** Anomalies live alongside devices — both are WS-pushed field-telemetry
   * collections consumed by the same map surface and inspector UI. */
  anomalies: Record<string, Anomaly>;
  /** One entry per device -- every device deployed today has at most one
   * camera (see ../../../zenoh_bridge/docs/video_streaming_pipeline.md's
   * scope note), keyed by deviceId so the inspector/verify modal can join a
   * device to its camera locally without the backend embedding it. */
  cameras: Record<string, CameraState>;
  /** At most one active diversion at a time — same "single current mission"
   * precedent the backend coordinator itself follows. */
  diversion: Diversion;
  setDevices: (devices: Device[]) => void;
  upsertDevice: (device: Device) => void;
  setAnomalies: (anomalies: Anomaly[]) => void;
  upsertAnomaly: (anomaly: Anomaly) => void;
  removeAnomaly: (anomalyId: string) => void;
  upsertCamera: (camera: CameraState) => void;
  setDiversionStarted: (raw: RawDiversionStarted) => void;
  setDiversionReturning: (raw: RawDiversionReturning) => void;
  clearDiversion: () => void;
}

export const useDeviceStore = create<DeviceStoreState>((set) => ({
  devices: {},
  anomalies: {},
  cameras: {},
  diversion: NO_DIVERSION,

  setDevices: (devices) =>
    set({ devices: Object.fromEntries(devices.map((d) => [d.deviceId, d])) }),

  upsertDevice: (device) =>
    set((s) => ({ devices: { ...s.devices, [device.deviceId]: device } })),

  upsertCamera: (camera) =>
    set((s) => ({ cameras: { ...s.cameras, [camera.deviceId]: camera } })),

  setAnomalies: (anomalies) =>
    set({ anomalies: Object.fromEntries(anomalies.map((a) => [a.anomalyId, a])) }),

  upsertAnomaly: (anomaly) =>
    set((s) => ({ anomalies: { ...s.anomalies, [anomaly.anomalyId]: anomaly } })),

  removeAnomaly: (anomalyId) =>
    set((s) => {
      if (!(anomalyId in s.anomalies)) return s;
      const anomalies = { ...s.anomalies };
      delete anomalies[anomalyId];
      return { anomalies };
    }),

  setDiversionStarted: (raw) =>
    set({
      diversion: {
        phase: "outbound",
        anomalyId: raw.anomaly_id,
        route: raw.route,
        target: { x: raw.target.x, y: raw.target.y, frameId: raw.target.frame_id, lat: raw.target.lat, lon: raw.target.lon },
        targetWaypointId: null,
      },
    }),

  setDiversionReturning: (raw) =>
    set({
      diversion: {
        phase: "returning",
        anomalyId: raw.anomaly_id,
        route: raw.route,
        target: null,
        targetWaypointId: raw.target_waypoint_id,
      },
    }),

  clearDiversion: () => set({ diversion: NO_DIVERSION }),
}));

export function selectDeviceList(state: DeviceStoreState): Device[] {
  return Object.values(state.devices).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export function selectAnomalyList(state: DeviceStoreState): Anomaly[] {
  return Object.values(state.anomalies).sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
}
