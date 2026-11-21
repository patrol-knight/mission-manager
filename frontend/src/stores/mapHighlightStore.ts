import { create } from "zustand";

interface MapHighlightState {
  /** The device whose card or row the pointer is over -- its map marker
   * grows (DeviceMarkerLayer). */
  hoveredDeviceId: string | null;
  /** The investigated anomaly, while its card is hovered -- its marker grows
   * (AnomalyLayer). */
  hoveredAnomalyId: string | null;
  /** The Explore card is hovered -- the explored point grows (ExploreLayer). */
  hoveredExplore: boolean;
  /** Anomalies drawn under the investigated anomaly's marker, by the tower
   * that reported them -- counted in a badge on that tower's marker instead
   * (AnomalyLayer fills it, DeviceMarkerLayer draws it). */
  hiddenByTower: Record<string, string[]>;
  setHoveredDevice: (deviceId: string | null) => void;
  setHoveredAnomaly: (anomalyId: string | null) => void;
  setHoveredExplore: (hovered: boolean) => void;
  setHiddenByTower: (hidden: Record<string, string[]>) => void;
}

export const useMapHighlightStore = create<MapHighlightState>((set, get) => ({
  hoveredDeviceId: null,
  hoveredAnomalyId: null,
  hoveredExplore: false,
  hiddenByTower: {},
  setHoveredDevice: (deviceId) => set({ hoveredDeviceId: deviceId }),
  setHoveredAnomaly: (anomalyId) => set({ hoveredAnomalyId: anomalyId }),
  setHoveredExplore: (hovered) => set({ hoveredExplore: hovered }),
  setHiddenByTower: (hidden) => {
    // Recomputed on every pan/zoom; only publish an actual change.
    if (JSON.stringify(hidden) !== JSON.stringify(get().hiddenByTower)) set({ hiddenByTower: hidden });
  },
}));
