import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { InvestigationNotifier } from "./InvestigationNotifier";
import { useInvestigationStore } from "../../stores/investigationStore";
import type { Investigation } from "./investigationTypes";

const handlers = vi.hoisted(() => new Map<string, (data: unknown) => void>());
vi.mock("../../api/realtimeClient", () => ({
  getRealtimeClient: () => ({
    on: (type: string, handler: (data: unknown) => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  }),
}));

const enRoute = { anomalyId: "a1", phase: "en_route", draftVerdict: null } as Investigation;

describe("InvestigationNotifier", () => {
  beforeEach(() => {
    useInvestigationStore.setState({ investigation: enRoute, selectedAnomalyId: null, verifyOpen: false });
  });

  it("opens the verify window when the robot arrives", () => {
    render(<ToastProvider><InvestigationNotifier /></ToastProvider>);
    act(() => useInvestigationStore.getState().setInvestigation({ ...enRoute, phase: "on_site" }));
    expect(useInvestigationStore.getState().verifyOpen).toBe(true);
    expect(screen.getByText("Arrived at the anomaly. Please verify.")).toBeInTheDocument();
  });

  it("doesn't treat switching to an anomaly already on site as an arrival", () => {
    render(<ToastProvider><InvestigationNotifier /></ToastProvider>);
    act(() => useInvestigationStore.getState().setInvestigation({ ...enRoute, anomalyId: "a2", phase: "on_site" }));
    expect(useInvestigationStore.getState().verifyOpen).toBe(false);
  });

  it("announces autonomy being aborted", () => {
    render(<ToastProvider><InvestigationNotifier /></ToastProvider>);
    act(() => handlers.get("autonomy.aborted")!({ reason: "robot_disconnected", anomaly_id: null }));
    expect(screen.getByText("The robot was lost. Mission and investigation stopped.")).toBeInTheDocument();
  });
});
