import { create } from "zustand";
import type { ExplorePreview, Investigation } from "../features/investigation/investigationTypes";

/** A point picked to Explore, before the robot is sent. */
export interface PickedPoint {
  lat: number;
  lon: number;
  /** null while it loads, or when it can't be reached (see error). */
  preview: ExplorePreview | null;
  error: string | null;
}

interface InvestigationStoreState {
  /** The robot's current investigation (server state); null when it isn't investigating. */
  investigation: Investigation | null;
  /** The anomaly whose card is open in the right panel (UI state). Never the
   * investigation target -- that one has its own Investigate card. */
  selectedAnomalyId: string | null;
  /** Whether the verify (or observe) window is open (UI state). */
  verifyOpen: boolean;
  /** Explore: map clicks pick the point to look at. */
  picking: boolean;
  /** The picked point, in its Explore card until sent or cancelled. It and
   * the selected anomaly share the panel's slot: one replaces the other. */
  picked: PickedPoint | null;
  setInvestigation: (investigation: Investigation | null) => void;
  selectAnomaly: (anomalyId: string | null) => void;
  openVerify: () => void;
  closeVerify: () => void;
  startPicking: () => void;
  /** Stops picking and drops the picked point, without sending the robot. */
  stopPicking: () => void;
  setPicked: (picked: PickedPoint | null) => void;
}

export const useInvestigationStore = create<InvestigationStoreState>((set) => ({
  investigation: null,
  selectedAnomalyId: null,
  verifyOpen: false,
  picking: false,
  picked: null,

  setInvestigation: (investigation) =>
    set((s) => ({
      investigation,
      // The selected anomaly just became the target: its card turns into the Investigate card.
      selectedAnomalyId:
        investigation && investigation.anomalyId !== null && s.selectedAnomalyId === investigation.anomalyId
          ? null
          : s.selectedAnomalyId,
      verifyOpen: investigation?.phase === "on_site" ? s.verifyOpen : false,
      // Likewise the picked point, once the robot is sent to it.
      ...(investigation?.kind === "explore" && { picking: false, picked: null }),
    })),

  selectAnomaly: (anomalyId) =>
    set((s) => {
      const selectedAnomalyId = anomalyId === s.investigation?.anomalyId ? null : anomalyId;
      return selectedAnomalyId ? { selectedAnomalyId, picking: false, picked: null } : { selectedAnomalyId };
    }),

  openVerify: () => set({ verifyOpen: true }),
  closeVerify: () => set({ verifyOpen: false }),

  startPicking: () => set({ picking: true, picked: null, selectedAnomalyId: null }),
  stopPicking: () => set({ picking: false, picked: null }),
  setPicked: (picked) => set({ picked }),
}));
