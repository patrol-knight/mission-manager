export type AnomalyStatus = "detected" | "robot_en_route" | "robot_arrived" | "verified";

/** See ../anomaly_detection/docs/topics_format.md section 2.1. */
export type AnomalyType = "lying_down" | "loitering" | "trespassing";

export type AnomalyResolution = "true_positive" | "false_positive";

export interface Anomaly {
  anomalyId: string;
  types: AnomalyType[];
  x: number;
  y: number;
  frameId: string;
  confidence: number;
  sourceDeviceId: string;
  status: AnomalyStatus;
  detectedAt: string;
  updatedAt: string;
  lastSeenAt: string;
  degradeSec: number;
  /** The backend drops the anomaly (`anomaly.expired`) once this passes
   * without a refresh, unless a robot is investigating it. */
  expiresAt: string;
  /** Computed once server-side (backend/models/anomaly.py::Anomaly.lat/lon) --
   * null only when the map service was unavailable at ingest time. */
  lat: number | null;
  lon: number | null;
  resolution: AnomalyResolution | null;
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
  status: AnomalyStatus;
  detected_at: string;
  updated_at: string;
  last_seen_at: string;
  degrade_sec: number;
  expires_at: string;
  lat: number | null;
  lon: number | null;
  resolution: AnomalyResolution | null;
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
    status: raw.status,
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
