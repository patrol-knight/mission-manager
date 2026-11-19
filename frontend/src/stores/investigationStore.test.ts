import { describe, it, expect, beforeEach } from "vitest";
import { selectPreviewing, useInvestigationStore } from "./investigationStore";
import type { Investigation } from "../features/investigation/investigationTypes";

const investigation: Investigation = {
  anomalyId: "a1",
  robotDeviceId: "robot-1",
  phase: "en_route",
  kind: "anomaly",
  lookAt: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  target: { x: 0, y: 0, frameId: "map", lat: null, lon: null },
  route: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} },
  etaSec: null,
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
    const after = useInvestigationStore.getState();
    expect(after.selectedAnomalyId).toBe("a2");
    expect(after.picking).toBe(false);
    expect(after.picked).toBeNull();
  });

  it("previews only a reachable point while nothing is investigated", () => {
    const point = { x: 0, y: 0, frameId: "map", lat: 1, lon: 2 };
    const preview = { lookAt: point, target: point, route: investigation.route, lengthM: 10, etaSec: 20 };
    const store = useInvestigationStore.getState();
    store.setPicked({ lat: 1, lon: 2, preview: null, error: null });
    expect(selectPreviewing(useInvestigationStore.getState())).toBe(false); // still loading
    store.setPicked({ lat: 1, lon: 2, preview, error: null });
    expect(selectPreviewing(useInvestigationStore.getState())).toBe(true);
    store.setInvestigation(investigation);
    expect(selectPreviewing(useInvestigationStore.getState())).toBe(false); // the mission is hidden anyway
  });
});
