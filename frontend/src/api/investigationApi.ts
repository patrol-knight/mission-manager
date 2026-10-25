import { http } from "./httpClient";
import type { AnomalyVerdict } from "../features/anomalies/anomalyTypes";
import {
  investigationFromRaw,
  type Investigation,
  type RawInvestigation,
} from "../features/investigation/investigationTypes";

/** Sends the robot to an anomaly, or switches to another one. */
export async function startInvestigation(anomalyId: string): Promise<Investigation> {
  return investigationFromRaw(await http.post<RawInvestigation>("/api/investigation", { anomaly_id: anomalyId }));
}

export async function setVerdict(verdict: AnomalyVerdict): Promise<Investigation> {
  return investigationFromRaw(await http.put<RawInvestigation>("/api/investigation/verdict", { verdict }));
}

/** Before arrival; nothing is recorded. */
export async function cancelInvestigation(): Promise<void> {
  await http.post<void>("/api/investigation/cancel");
}

/** On site; commits the verdict. */
export async function finishInvestigation(): Promise<void> {
  await http.post<void>("/api/investigation/finish");
}
