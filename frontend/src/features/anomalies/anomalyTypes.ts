/** See ../anomaly_detection/docs/topics_format.md section 2.1. */
export type AnomalyType = "lying_down" | "loitering" | "trespassing";

/** The operator's on-site verdict. Only true/false positive are final; an
 * "unclear" anomaly stays on the map and can be investigated again. */
export type AnomalyVerdict = "true_positive" | "false_positive" | "unclear";

export interface Anomaly {
  anomalyId: string;
  types: AnomalyType[];
  x: number;
  y: number;
  frameId: string;
  confidence: number;
  sourceDeviceId: string;
  detectedAt: string;
  updatedAt: string;
  lastSeenAt: string;
  degradeSec: number;
  /** The backend drops the anomaly (`anomaly.expired`) once this passes
   * without a refresh, unless the robot is investigating it. */
  expiresAt: string;
  /** Computed once server-side (backend/models/anomaly.py::Anomaly.lat/lon) --
   * null only when the map service was unavailable at ingest time. */
  lat: number | null;
  lon: number | null;
  /** null = never verified. */
  resolution: AnomalyVerdict | null;
  resolvedAt: string | null;
  missionId: string | null;
}

/** Wire shape — see backend/models/anomaly.py::Anomaly. */
export interface RawAnomaly {
  anomaly_id: string;
  types: AnomalyType[];
  x: number;
  y: number;
  frame_id: string;
  confidence: number;
  source_device_id: string;
  detected_at: string;
  updated_at: string;
  last_seen_at: string;
  degrade_sec: number;
  expires_at: string;
  lat: number | null;
  lon: number | null;
  resolution: AnomalyVerdict | null;
  resolved_at: string | null;
  mission_id: string | null;
}

export function anomalyFromRaw(raw: RawAnomaly): Anomaly {
  return {
    anomalyId: raw.anomaly_id,
    types: raw.types,
    x: raw.x,
    y: raw.y,
    frameId: raw.frame_id,
    confidence: raw.confidence,
    sourceDeviceId: raw.source_device_id,
    detectedAt: raw.detected_at,
    updatedAt: raw.updated_at,
    lastSeenAt: raw.last_seen_at,
    degradeSec: raw.degrade_sec,
    expiresAt: raw.expires_at,
    lat: raw.lat,
    lon: raw.lon,
    resolution: raw.resolution,
    resolvedAt: raw.resolved_at,
    missionId: raw.mission_id,
  };
}

/** Wire shape of `anomaly.expired`. */
export interface RawAnomalyExpired {
  anomaly_id: string;
}

/** A final verdict closes the anomaly: it leaves the map and can't be investigated again. */
export function isClosed(anomaly: Anomaly): boolean {
  return anomaly.resolution === "true_positive" || anomaly.resolution === "false_positive";
}

const TYPE_LABELS: Record<AnomalyType, string> = {
  lying_down: "Lying down",
  loitering: "Loitering",
  trespassing: "Trespassing",
};

export function formatAnomalyTypes(types: AnomalyType[]): string {
  return types.map((t) => TYPE_LABELS[t]).join(", ");
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/** First 8 characters of the UUID -- enough to tell anomalies apart on screen. */
export function shortAnomalyId(anomalyId: string): string {
  return anomalyId.slice(0, 8);
}

export const VERDICT_LABELS: Record<AnomalyVerdict, string> = {
  true_positive: "TRUE",
  false_positive: "FALSE",
  unclear: "UNCLEAR",
};

export const VERDICT_COLORS: Record<AnomalyVerdict, string> = {
  true_positive: "#e03131",
  false_positive: "#2f9e44",
  unclear: "#868e96",
};
