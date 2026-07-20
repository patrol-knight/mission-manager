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
