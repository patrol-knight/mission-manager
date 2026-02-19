import { create } from "zustand";

export type Waypoint = {
  id: string;
  x: number;
  y: number;
  yaw: number;
};

export type Mode = "off" | "modify" | "delete";

type State = {
  waypoints: Waypoint[];
  mode: Mode;
  add: (wp: Waypoint) => void;
  update: (id: string, x: number, y: number) => void;
  remove: (id: string) => void;
  setYaw: (id: string, yaw: number) => void;

  setMode: (mode: Mode) => void;
};

export const useWaypoint = create<State>((set) => ({
  waypoints: [],
  mode: "off",

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

  setYaw: (id, yaw) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) =>
        w.id === id ? { ...w, yaw } : w
      ),
    })),

  setMode: (mode) =>
    set({ mode }),
}));