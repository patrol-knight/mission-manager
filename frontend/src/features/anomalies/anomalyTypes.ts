export type AnomalyStatus = "detected" | "robot_en_route" | "robot_arrived" | "verified";

export interface Anomaly {
  anomalyId: string;
  x: number;
  y: number;
  frameId: string;
  status: AnomalyStatus;
  detectedAt: string;
  updatedAt: string;
  sourceDeviceId: string | null;
  description: string | null;
  /** Computed once server-side (backend/models/anomaly.py::Anomaly.lat/lon) --
   * null only when the map service was unavailable at ingest time. */
  lat: number | null;
  lon: number | null;
}

/** Wire shape — see backend/models/anomaly.py::Anomaly. */
export interface RawAnomaly {
  anomaly_id: string;
  x: number;
  y: number;
  frame_id: string;
  status: AnomalyStatus;
  detected_at: string;
  updated_at: string;
  source_device_id: string | null;
  description: string | null;
  lat: number | null;
  lon: number | null;
}

export function anomalyFromRaw(raw: RawAnomaly): Anomaly {
  return {
    anomalyId: raw.anomaly_id,
    x: raw.x,
    y: raw.y,
    frameId: raw.frame_id,
    status: raw.status,
    detectedAt: raw.detected_at,
    updatedAt: raw.updated_at,
    sourceDeviceId: raw.source_device_id,
    description: raw.description,
    lat: raw.lat,
    lon: raw.lon,
  };
}
