import { create } from "zustand";
import type { Waypoint, Mode, RouteWaypoint } from "../types";

export type RouteGoalState = "pending" | "current" | "done";

export type RouteGoal = RouteWaypoint & { state: RouteGoalState };

export type RouteProgress = {
  goals: RouteGoal[];
  currentGoalIdx: number;
  routeCoords: { x: number; y: number }[];
  active: boolean;
  speed: number;
};

type WaypointState = {
  waypoints: Waypoint[];
  mode: Mode;
  routeProgress: RouteProgress | null;
  add: (wp: Waypoint) => void;
  update: (id: string, x: number, y: number) => void;
  remove: (id: string) => void;
  setYaw: (id: string, yaw: number) => void;
  setMode: (mode: Mode) => void;
  clear: () => void;
  setRouteProgress: (rp: RouteProgress | null) => void;
  advanceGoal: (idx: number, speed: number) => void;
};

export const useWaypointStore = create<WaypointState>((set) => ({
  waypoints: [],
  mode: "off" as Mode,
  routeProgress: null,

  add: (wp) => set((s) => ({ waypoints: [...s.waypoints, wp] })),

  update: (id, x, y) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) => (w.id === id ? { ...w, x, y } : w)),
    })),

  remove: (id) =>
    set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) })),

  setYaw: (id, yaw) =>
    set((s) => ({
      waypoints: s.waypoints.map((w) => (w.id === id ? { ...w, yaw } : w)),
    })),

  setMode: (mode) => set({ mode }),

  clear: () => set({ waypoints: [] }),

  setRouteProgress: (rp) => set({ routeProgress: rp }),

  advanceGoal: (idx, speed) =>
    set((s) => {
      if (!s.routeProgress) return s;
      const goals = s.routeProgress.goals.map((g, i) =>
        i < idx ? { ...g, state: "done" as RouteGoalState } :
        i === idx ? { ...g, state: "current" as RouteGoalState } : g
      );
      return { routeProgress: { ...s.routeProgress, goals, currentGoalIdx: idx, speed } };
    }),
}));
