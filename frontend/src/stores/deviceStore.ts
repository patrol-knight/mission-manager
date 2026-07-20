import { create } from "zustand";
import type { Device } from "../types/domain";
import type { Anomaly } from "../features/anomalies/anomalyTypes";

interface DeviceStoreState {
  devices: Record<string, Device>;
  /** Anomalies live alongside devices — both are WS-pushed field-telemetry
   * collections consumed by the same map surface and inspector UI. */
  anomalies: Record<string, Anomaly>;
  setDevices: (devices: Device[]) => void;
  upsertDevice: (device: Device) => void;
  setAnomalies: (anomalies: Anomaly[]) => void;
  upsertAnomaly: (anomaly: Anomaly) => void;
}

export const useDeviceStore = create<DeviceStoreState>((set) => ({
  devices: {},
  anomalies: {},

  setDevices: (devices) =>
    set({ devices: Object.fromEntries(devices.map((d) => [d.deviceId, d])) }),

  upsertDevice: (device) =>
    set((s) => ({ devices: { ...s.devices, [device.deviceId]: device } })),

  setAnomalies: (anomalies) =>
    set({ anomalies: Object.fromEntries(anomalies.map((a) => [a.anomalyId, a])) }),

  upsertAnomaly: (anomaly) =>
    set((s) => ({ anomalies: { ...s.anomalies, [anomaly.anomalyId]: anomaly } })),
}));

export function selectDeviceList(state: DeviceStoreState): Device[] {
  return Object.values(state.devices).sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export function selectAnomalyList(state: DeviceStoreState): Anomaly[] {
  return Object.values(state.anomalies).sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
}
