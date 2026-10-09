import { describe, it, expect, beforeEach } from "vitest";
import { useInvestigationStore } from "./investigationStore";
import type { Investigation } from "../features/investigation/investigationTypes";

const investigation: Investigation = {
  anomalyId: "a1",
  robotDeviceId: "robot-1",
  phase: "en_route",
  target: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
  draftVerdict: null,
  startedAt: "2026-10-08T00:00:00Z",
  arrivedAt: null,
};

describe("investigationStore", () => {
  beforeEach(() => {
    useInvestigationStore.setState({ investigation: null, selectedAnomalyId: null, verifyOpen: false });
  });

  it("drops the selection once the selected anomaly becomes the target", () => {
    const store = useInvestigationStore.getState();
    store.selectAnomaly("a1");
    store.setInvestigation(investigation);
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
  });

  it("keeps another selection while investigating, but never selects the target", () => {
    const store = useInvestigationStore.getState();
    store.setInvestigation(investigation);
    store.selectAnomaly("a1");
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
    store.selectAnomaly("b2");
    expect(useInvestigationStore.getState().selectedAnomalyId).toBe("b2");
  });

  it("closes the verify window when the robot is no longer on site", () => {
    const store = useInvestigationStore.getState();
    store.setInvestigation({ ...investigation, phase: "on_site" });
    store.openVerify();
    expect(useInvestigationStore.getState().verifyOpen).toBe(true);
    store.setInvestigation(null);
    expect(useInvestigationStore.getState().verifyOpen).toBe(false);
  });
});
