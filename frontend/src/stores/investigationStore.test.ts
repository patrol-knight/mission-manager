import { describe, it, expect, beforeEach } from "vitest";
import { useInvestigationStore } from "./investigationStore";
import type { Investigation } from "../features/investigation/investigationTypes";

const investigation: Investigation = {
  kind: "anomaly",
  anomalyId: "a1",
  robotDeviceId: "robot-1",
  phase: "en_route",
  lookAt: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  target: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
  draftVerdict: null,
  startedAt: "2026-10-08T00:00:00Z",
  arrivedAt: null,
};

describe("investigationStore", () => {
  beforeEach(() => {
    useInvestigationStore.setState({ investigation: null, selectedAnomalyId: null, verifyOpen: false, picking: false, picked: null });
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

  it("a picked point and a selected anomaly share the panel: one replaces the other", () => {
    const store = useInvestigationStore.getState();
    store.selectAnomaly("a1");
    store.startPicking();
    expect(useInvestigationStore.getState().selectedAnomalyId).toBeNull();
    store.setPicked({ lat: 1, lon: 2, preview: null, error: null });
    store.selectAnomaly("a2");
    expect(useInvestigationStore.getState()).toMatchObject({ selectedAnomalyId: "a2", picking: false, picked: null });
  });

  it("sending the robot to the picked point ends picking", () => {
    const store = useInvestigationStore.getState();
    store.startPicking();
    store.setPicked({ lat: 1, lon: 2, preview: null, error: null });
    store.setInvestigation({ ...investigation, kind: "explore", anomalyId: null });
    expect(useInvestigationStore.getState()).toMatchObject({ picking: false, picked: null });
  });
});
