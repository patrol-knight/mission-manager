import { create } from "zustand";

interface LibraryStoreState {
  /** The mission row expanded in the library, whose route the map previews. */
  selectedMissionId: string | null;
  selectMission: (missionId: string | null) => void;
}

export const useLibraryStore = create<LibraryStoreState>((set) => ({
  selectedMissionId: null,
  selectMission: (selectedMissionId) => set({ selectedMissionId }),
}));
