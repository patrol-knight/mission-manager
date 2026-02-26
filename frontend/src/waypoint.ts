import { create } from "zustand";

export type Waypoint = {
  id: string;
  x: number;
  y: number;
  yaw: number;
};

export type Mode = "off" | "init" | "modify" | "delete";

type State = {
  waypoints: Waypoint[];
  mode: Mode;
  clearedAt: number | null;
  add: (wp: Waypoint) => void;
  update: (id: string, x: number, y: number) => void;
  remove: (id: string) => void;
  clearAll: () => void;
  reorder: (fromIndex: number, toIndex: number) => void;
  setYaw: (id: string, yaw: number) => void;
  setMode: (mode: Mode) => void;
};

export const useWaypoint = create<State>((set) => ({
  waypoints: [],
  mode: "off",
  clearedAt: null,

  add: (wp) =>
    set((s) => ({ waypoints: [...s.waypoints, wp] })),

  update: (id, x, y) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) =>
        w.id === id ? { ...w, x, y } : w
      ),
    })),

  remove: (id) =>
    set((s) => ({
      waypoints: s.waypoints.filter((w) => w.id !== id),
    })),

  clearAll: () => set({ waypoints: [], clearedAt: Date.now() }),

  reorder: (fromIndex: number, toIndex: number) =>
    set((s) => {
      const waypoints = [...s.waypoints];
      const [moved] = waypoints.splice(fromIndex, 1);
      waypoints.splice(toIndex, 0, moved);
      return { waypoints };
    }),

  setYaw: (id, yaw) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) =>
        w.id === id ? { ...w, yaw } : w
      ),
    })),

  setMode: (mode) =>
    set({ mode }),
}));