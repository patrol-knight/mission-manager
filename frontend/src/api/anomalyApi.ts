import { http } from "./httpClient";
import { anomalyFromRaw, type Anomaly, type RawAnomaly } from "../features/anomalies/anomalyTypes";

export async function listAnomalies(): Promise<Anomaly[]> {
  const raw = await http.get<RawAnomaly[]>("/api/anomalies");
  return raw.map(anomalyFromRaw);
}

export async function verifyAnomaly(anomalyId: string): Promise<Anomaly> {
  const raw = await http.post<RawAnomaly>(`/api/anomalies/${encodeURIComponent(anomalyId)}/verify`);
  return anomalyFromRaw(raw);
}

/** Dismissing the arrival toast without opening the inspector -- resolves
 * the anomaly the same way verifyAnomaly does (see backend
 * AnomalyRegistry._resolve's docstring: no false-positive classification
 * in this codebase) and, the same as verify, triggers the robot's
 * return-to-mission leg. */
export async function dismissAnomaly(anomalyId: string): Promise<Anomaly> {
  const raw = await http.post<RawAnomaly>(`/api/anomalies/${encodeURIComponent(anomalyId)}/dismiss`);
  return anomalyFromRaw(raw);
}
