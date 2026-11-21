import { http } from "./httpClient";
import type { AnomalyVerdict } from "../features/anomalies/anomalyTypes";
import type { components } from "./schema";
import {
  explorePreviewFromRaw,
  investigationFromRaw,
  type ExplorePreview,
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

/** Where Explore would stop to look at this point; sends nothing. */
export async function previewExplore(lat: number, lon: number): Promise<ExplorePreview> {
  return explorePreviewFromRaw(
    await http.post<components["schemas"]["ExplorePreview"]>("/api/investigation/explore/preview", { lat, lon }),
  );
}

/** Explore: sends the robot to look at this point, or retargets it. */
export async function startExplore(lat: number, lon: number): Promise<Investigation> {
  return investigationFromRaw(await http.post<RawInvestigation>("/api/investigation/explore", { lat, lon }));
}
