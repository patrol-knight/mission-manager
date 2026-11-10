import { http } from "../../api/httpClient";
import type { DevStatus } from "./devStore";

export const devApi = {
  startRun: () => http.post<{ run_id: string }>("/api/dev/runs"),
  stopRun: () => http.post<{ run_id: string | null }>("/api/dev/runs/stop"),
  setTarget: (deviceId: string, ip: string | null) =>
    http.put<DevStatus>(`/api/dev/targets/${encodeURIComponent(deviceId)}`, { ip }),
  setInitialPose: (lat: number, lon: number, yaw: number) =>
    http.post<void>("/api/dev/initial-pose", { lat, lon, yaw }),
};
