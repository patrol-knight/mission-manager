import { http } from "../../api/httpClient";
import type { DevStatus } from "./devStore";

export interface RunSummary {
  run_id: string;
  label: string;
  started_at: string | null;
  ended_at: string | null;
}

export const devApi = {
  listRuns: () => http.get<RunSummary[]>("/api/dev/runs"),
  startRun: (label: string, notes: string) => http.post<{ run_id: string }>("/api/dev/runs", { label, notes }),
  stopRun: () => http.post<{ run_id: string | null }>("/api/dev/runs/stop"),
  setTarget: (deviceId: string, ip: string | null) =>
    http.put<DevStatus>(`/api/dev/targets/${encodeURIComponent(deviceId)}`, { ip }),
};
