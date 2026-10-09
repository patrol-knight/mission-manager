import { create } from "zustand";
import type { CameraState, Device } from "../types/domain";
import type { Anomaly } from "../features/anomalies/anomalyTypes";

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
  setDevices: (devices: Device[]) => void;
  upsertDevice: (device: Device) => void;
  setAnomalies: (anomalies: Anomaly[]) => void;
  upsertAnomaly: (anomaly: Anomaly) => void;
  removeAnomaly: (anomalyId: string) => void;
  upsertCamera: (camera: CameraState) => void;
}

export const useDeviceStore = create<DeviceStoreState>((set) => ({
  devices: {},
  anomalies: {},
  cameras: {},

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
}));

export function selectDeviceList(state: DeviceStoreState): Device[] {
  return Object.values(state.devices).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export function selectAnomalyList(state: DeviceStoreState): Anomaly[] {
  return Object.values(state.anomalies).sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
}

/** The robot (single-robot deployment), connected or not. */
export function selectRobot(state: DeviceStoreState): Device | null {
  return selectDeviceList(state).find((d) => d.type === "robot") ?? null;
}
