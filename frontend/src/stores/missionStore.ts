import { create } from "zustand";
import type { MissionDefinition, MissionExecutionState } from "../features/missions/missionTypes";

interface MissionStoreState {
  /** The authored mission configuration. */
  definition: MissionDefinition | null;
  /** Runtime execution progress; `null` when no mission is current. */
  execution: MissionExecutionState | null;
  setDefinition: (definition: MissionDefinition | null) => void;
  setExecution: (execution: MissionExecutionState | null) => void;
}

export const useMissionStore = create<MissionStoreState>((set) => ({
  definition: null,
  execution: null,

  setDefinition: (definition) => set({ definition }),
  setExecution: (execution) => set({ execution }),
}));
