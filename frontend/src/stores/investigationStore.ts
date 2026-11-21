import { create } from "zustand";
import type { Investigation } from "../features/investigation/investigationTypes";

interface InvestigationStoreState {
  /** The robot's current investigation (server state); null when it isn't investigating. */
  investigation: Investigation | null;
  /** The anomaly whose card is open in the right panel (UI state). Never the
   * investigation target -- that one has its own Investigate card. */
  selectedAnomalyId: string | null;
  /** Whether the verify window is open (UI state). */
  verifyOpen: boolean;
  setInvestigation: (investigation: Investigation | null) => void;
  selectAnomaly: (anomalyId: string | null) => void;
  openVerify: () => void;
  closeVerify: () => void;
}

export const useInvestigationStore = create<InvestigationStoreState>((set) => ({
  investigation: null,
  selectedAnomalyId: null,
  verifyOpen: false,

  setInvestigation: (investigation) =>
    set((s) => ({
      investigation,
      // The selected anomaly just became the target: its card turns into the Investigate card.
      selectedAnomalyId: investigation && s.selectedAnomalyId === investigation.anomalyId ? null : s.selectedAnomalyId,
      verifyOpen: investigation?.phase === "on_site" ? s.verifyOpen : false,
    })),

  selectAnomaly: (anomalyId) =>
    set((s) => ({ selectedAnomalyId: anomalyId === s.investigation?.anomalyId ? null : anomalyId })),

  openVerify: () => set({ verifyOpen: true }),
  closeVerify: () => set({ verifyOpen: false }),
}));
