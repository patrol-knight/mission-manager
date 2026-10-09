import type { AnomalyVerdict } from "../anomalies/anomalyTypes";

/** See backend/models/investigation.py and docs/investigate-mode-design.md §4.2. */
export type InvestigationPhase = "en_route" | "on_site";

export interface InvestigationTarget {
  x: number;
  y: number;
  frameId: string;
  lat: number | null;
  lon: number | null;
}

export interface Investigation {
  anomalyId: string;
  robotDeviceId: string;
  phase: InvestigationPhase;
  /** The anomaly's position snapped to the lanelet network, frozen at start. */
  target: InvestigationTarget;
  route: GeoJSON.Feature<GeoJSON.LineString>;
  /** null until the operator picks one on site; committed when the robot leaves. */
  draftVerdict: AnomalyVerdict | null;
  startedAt: string;
  arrivedAt: string | null;
}

/** Wire shape — see backend/models/investigation.py::InvestigationState. */
export interface RawInvestigation {
  anomaly_id: string;
  robot_device_id: string;
  phase: InvestigationPhase;
  target: { x: number; y: number; frame_id: string; lat: number | null; lon: number | null };
  route: GeoJSON.Feature<GeoJSON.LineString>;
  draft_verdict: AnomalyVerdict | null;
  started_at: string;
  arrived_at: string | null;
}

export function investigationFromRaw(raw: RawInvestigation): Investigation {
  return {
    anomalyId: raw.anomaly_id,
    robotDeviceId: raw.robot_device_id,
    phase: raw.phase,
    target: { x: raw.target.x, y: raw.target.y, frameId: raw.target.frame_id, lat: raw.target.lat, lon: raw.target.lon },
    route: raw.route,
    draftVerdict: raw.draft_verdict,
    startedAt: raw.started_at,
    arrivedAt: raw.arrived_at,
  };
}

/** Wire shape of `investigation.cancelled` (the robot went offline). */
export interface RawInvestigationCancelled {
  anomaly_id: string;
  reason: string;
}

/** On site without a verdict: the robot can't leave and other anomalies can't be picked yet. */
export function needsVerdict(investigation: Investigation | null): boolean {
  return investigation !== null && investigation.phase === "on_site" && investigation.draftVerdict === null;
}
