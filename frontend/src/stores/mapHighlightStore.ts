import { create } from "zustand";

interface MapHighlightState {
  /** The device whose card or row the pointer is over -- its map marker
   * grows (DeviceMarkerLayer). */
  hoveredDeviceId: string | null;
  /** Anomalies drawn under the investigated anomaly's marker, by the tower
   * that reported them -- counted in a badge on that tower's marker instead
   * (AnomalyLayer fills it, DeviceMarkerLayer draws it). */
  hiddenByTower: Record<string, string[]>;
  setHoveredDevice: (deviceId: string | null) => void;
  setHiddenByTower: (hidden: Record<string, string[]>) => void;
}

export const useMapHighlightStore = create<MapHighlightState>((set, get) => ({
  hoveredDeviceId: null,
  hiddenByTower: {},
  setHoveredDevice: (deviceId) => set({ hoveredDeviceId: deviceId }),
  setHiddenByTower: (hidden) => {
    // Recomputed on every pan/zoom; only publish an actual change.
    if (JSON.stringify(hidden) !== JSON.stringify(get().hiddenByTower)) set({ hiddenByTower: hidden });
  },
}));
