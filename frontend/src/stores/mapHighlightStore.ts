import { create } from "zustand";

interface MapHighlightState {
  /** The tower whose row the pointer is over in the towers list -- its map
   * marker grows and gets a halo (DeviceMarkerLayer). */
  hoveredTowerId: string | null;
  /** Anomalies drawn under the investigated anomaly's marker, by the tower
   * that reported them -- counted in a badge on that tower's marker instead
   * (AnomalyLayer fills it, DeviceMarkerLayer draws it). */
  hiddenByTower: Record<string, string[]>;
  setHoveredTower: (deviceId: string | null) => void;
  setHiddenByTower: (hidden: Record<string, string[]>) => void;
}

export const useMapHighlightStore = create<MapHighlightState>((set, get) => ({
  hoveredTowerId: null,
  hiddenByTower: {},
  setHoveredTower: (deviceId) => set({ hoveredTowerId: deviceId }),
  setHiddenByTower: (hidden) => {
    // Recomputed on every pan/zoom; only publish an actual change.
    if (JSON.stringify(hidden) !== JSON.stringify(get().hiddenByTower)) set({ hiddenByTower: hidden });
  },
}));
