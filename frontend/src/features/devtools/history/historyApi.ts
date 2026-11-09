import { API_BASE_URL } from "../../../api/config";
import { http } from "../../../api/httpClient";

const BASE = "/api/dev/history";

export type Source = "sim" | "real";
export type SourceFilter = Source | "all";
export type Verdict = "true_positive" | "unclear" | "expired" | "false_positive";

export interface HeatmapDefaults {
  sources: Source[];
  bandwidth_m: number;
  half_life_days: number;
  prior_hours: number;
  floor_per_hour: number;
  ceiling_per_hour: number;
}

export interface HistoryStatus {
  database: { configured: boolean; connected?: boolean; schema_ready?: boolean; error?: string | null };
  map_name: string | null;
  estimator_installed: boolean;
  write_enabled: boolean;
  current_session_id: string | null;
  heatmap: HeatmapDefaults;
}

export interface VerdictCounts {
  true_positive: number;
  unclear: number;
  expired: number;
  false_positive: number;
}

export interface SessionRow extends VerdictCounts {
  id: string;
  map_name: string;
  map_hash: string | null;
  source: Source;
  started_at: string;
  ended_at: string | null;
  last_seen_at: string | null;
  excluded: boolean;
  label: string | null;
  total: number;
  last_at: string | null;
}

export interface SessionPatch {
  excluded?: boolean;
  source?: Source;
  label?: string;
}

export interface Estimate {
  mean: number;
  low: number;
  high: number;
}

export interface DeviceRow extends VerdictCounts {
  device_id: string;
  alerts: number;
  online_hours: number | null;
  alert_rate: Estimate | null;
  true_rate: Estimate;
  missed_rate: Estimate;
  dispatch_delay_s: number | null;
  travel_s: number | null;
}

export interface DevicesReport {
  system_hours: number;
  devices: DeviceRow[];
}

export interface HeatmapGrid {
  width: number;
  height: number;
  data: string;
  corners: number[][];
}

export interface HeatmapPreview {
  grid: HeatmapGrid | null;
  points: { lon: number; lat: number; verdict: Verdict; weight: number }[];
  stats: {
    records: number;
    counts: VerdictCounts;
    operating_hours?: number;
    peak_per_hour?: number;
    elapsed_ms: number;
  };
}

export interface SeedRequest {
  source: Source;
  sessions: number;
  anomalies_per_session: number;
  days: number;
  hotspots: number;
  hotspot_share: number;
}

export interface Generated {
  sessions: number;
  anomalies: number;
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : "";
}

export const historyApi = {
  status: () => http.get<HistoryStatus>(`${BASE}/status`),
  sessions: () => http.get<SessionRow[]>(`${BASE}/sessions`),
  updateSession: (id: string, patch: SessionPatch) => http.patch<void>(`${BASE}/sessions/${id}`, patch),
  deleteSession: (id: string) => http.delete<void>(`${BASE}/sessions/${id}`),
  purge: (source: Source, olderThanDays: number) =>
    http.post<{ anomalies: number; sessions: number }>(`${BASE}/purge`, { source, older_than_days: olderThanDays }),
  seed: (request: SeedRequest) => http.post<Generated>(`${BASE}/seed`, request),
  scenarios: () => http.get<{ file: string; yaml: string }[]>(`${BASE}/scenarios`),
  loadScenario: (yaml: string) => http.post<Generated & { name: string }>(`${BASE}/scenario`, { yaml }),
  devices: (source: SourceFilter, includeExcluded: boolean) =>
    http.get<DevicesReport>(`${BASE}/devices${query({ source, include_excluded: includeExcluded })}`),
  heatmap: (params: Record<string, string | number | boolean>) =>
    http.get<HeatmapPreview>(`${BASE}/heatmap${query(params)}`),
  exportUrl: (params: { map_name?: string; source?: Source; session_id?: string }) =>
    `${API_BASE_URL}${BASE}/export.csv${query(params)}`,
};
