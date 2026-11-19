import type { components } from "../../api/schema";
import type { AnomalyVerdict } from "../anomalies/anomalyTypes";

/** See backend/models/investigation.py and the README's state machine section. */
export type InvestigationPhase = "en_route" | "on_site";

export interface InvestigationTarget {
  x: number;
  y: number;
  frameId: string;
  lat: number | null;
  lon: number | null;
}

/** "anomaly": sent to an anomaly, ends with a verdict. "manual": Explore,
 * sent by the operator to look at a point, ends when dismissed. */
export type InvestigationKind = "anomaly" | "manual";

export interface Investigation {
  kind: InvestigationKind;
  /** Set exactly for "anomaly". */
  anomalyId: string | null;
  robotDeviceId: string;
  phase: InvestigationPhase;
  /** What the robot is sent to look at: the anomaly, or the clicked point. */
  lookAt: InvestigationTarget;
  /** Where it stops to look, frozen at start. */
  target: InvestigationTarget;
  route: GeoJSON.Feature<GeoJSON.LineString>;
  /** Estimated seconds from start to arrival. */
  etaSec: number | null;
  /** null until the operator picks one on site; committed when the robot leaves. */
  draftVerdict: AnomalyVerdict | null;
  startedAt: string;
  arrivedAt: string | null;
}

/** The backend types route as a plain dict. */
export type RawInvestigation = Omit<components["schemas"]["InvestigationState"], "route"> & {
  route: GeoJSON.Feature<GeoJSON.LineString>;
};

type RawPoint = components["schemas"]["MapPoint"];

function targetFromRaw(raw: RawPoint): InvestigationTarget {
  return { x: raw.x, y: raw.y, frameId: raw.frame_id, lat: raw.lat ?? null, lon: raw.lon ?? null };
}

export function investigationFromRaw(raw: RawInvestigation): Investigation {
  return {
    kind: raw.kind ?? "anomaly",
    anomalyId: raw.anomaly_id ?? null,
    robotDeviceId: raw.robot_device_id,
    phase: raw.phase,
    lookAt: targetFromRaw(raw.look_at),
    target: targetFromRaw(raw.target),
    route: raw.route,
    etaSec: raw.eta_sec ?? null,
    draftVerdict: raw.draft_verdict,
    startedAt: raw.started_at,
    arrivedAt: raw.arrived_at,
  };
}

/** Wire shape of `autonomy.aborted`: the mission and any investigation were
 * stopped, and nothing resumes until the operator starts again. */
export interface RawAutonomyAborted {
  reason: "robot_disconnected" | string;
  /** The investigation that was cancelled, if any. */
  anomaly_id: string | null;
}

/** Wire shape of `autonomy.paused`: the mission was paused because the robot
 * couldn't finish its goal. */
export interface RawAutonomyPaused {
  reason: string;
}

const ABORT_REASONS: Record<string, string> = {
  robot_disconnected: "The robot was lost",
  robot_failure: "The robot reported a failure",
  robot_manual: "The robot was taken over manually",
  robot_estop: "The emergency stop was pressed",
  robot_notready: "The robot is not ready",
  goal_route_rejected: "No route to the goal",
  goal_route_aborted: "The route was aborted",
  goal_not_moving: "The robot stopped moving",
  goal_manual_takeover: "The robot was taken over manually",
  goal_route_cleared: "The route was cleared",
  goal_cancelled: "The goal was cancelled on the robot",
};

const FAILURE_REASONS = ["robot_failure", "goal_route_rejected", "goal_route_aborted", "goal_not_moving"];

export function isFailureReason(reason: string): boolean {
  return FAILURE_REASONS.includes(reason);
}

export function describeAbort(raw: RawAutonomyAborted): string {
  return ABORT_REASONS[raw.reason] ?? `Stopped (${raw.reason})`;
}

export function describePause(raw: RawAutonomyPaused): { title: string; hint: string } {
  return raw.reason === "goal_not_moving"
    ? {
        title: "The robot stopped moving. Mission paused.",
        hint: "Drive the robot with RC, then Resume once it's ready, or Cancel the mission.",
      }
    : {
        title: "No route from where the robot is. Mission paused.",
        hint: "Drive the robot back onto the lanes with RC, then Resume once it's ready, or Cancel the mission.",
      };
}

/** On site at an anomaly without a verdict: the robot can't leave for another anomaly yet. */
export function needsVerdict(investigation: Investigation | null): boolean {
  return (
    investigation !== null &&
    investigation.kind === "anomaly" &&
    investigation.phase === "on_site" &&
    investigation.draftVerdict === null
  );
}

/** Where Explore would send the robot (POST /api/investigation/goto/preview). */
export interface ExplorePreview {
  lookAt: InvestigationTarget;
  /** Where the robot would stop to look. */
  target: InvestigationTarget;
  /** From the robot, as it stood when previewed, to `target`. */
  route: GeoJSON.Feature<GeoJSON.LineString>;
  lengthM: number;
  etaSec: number;
}

export type RawExplorePreview = Omit<components["schemas"]["GoToPreview"], "route"> & {
  route: GeoJSON.Feature<GeoJSON.LineString>;
};

export function explorePreviewFromRaw(raw: RawExplorePreview): ExplorePreview {
  return {
    lookAt: targetFromRaw(raw.look_at),
    target: targetFromRaw(raw.target),
    route: raw.route,
    lengthM: raw.length_m,
    etaSec: raw.eta_sec,
  };
}
