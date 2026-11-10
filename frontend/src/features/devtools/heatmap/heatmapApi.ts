import type { components } from "../../../api/schema";
import { http } from "../../../api/httpClient";

type Schemas = components["schemas"];
export type HeatmapConfig = Schemas["HeatmapConfig-Output"];
export type BaselineSpec = Schemas["BaselineSpec-Output"];
export type Hotspot = Schemas["Hotspot-Output"];
export type VerdictShares = Schemas["VerdictShares-Output"];
export type HeatmapState = Schemas["HeatmapState"];
export type HeatmapPreview = Schemas["HeatmapPreview"];
export type DemoEvent = Schemas["DemoEvent"];
export type Verdict = keyof VerdictShares;
type AnomalyType = Hotspot["types"][number];
export type View = "baseline" | "all";

export const VERDICTS: [Verdict, string, string][] = [
  ["true_positive", "True", "var(--color-verdict-true)"],
  ["unclear", "Unclear", "var(--color-verdict-unclear)"],
  ["false_positive", "False", "var(--color-verdict-false)"],
  ["expired", "Expired", "var(--color-text-faint)"],
];

export const TYPES: [AnomalyType, string][] = [
  ["trespassing", "Trespassing"],
  ["loitering", "Loitering"],
  ["lying_down", "Lying down"],
];

const BASE = "/api/dev/heatmap";

export const heatmapApi = {
  state: () => http.get<HeatmapState>(BASE),
  preview: (body: { config: HeatmapConfig; view: View; spec: BaselineSpec | null; demo: DemoEvent[] }) =>
    http.post<HeatmapPreview>(`${BASE}/preview`, body),
  saveConfig: (config: HeatmapConfig) => http.put<void>(`${BASE}/config`, config),
  saveBaseline: (spec: BaselineSpec) => http.put<HeatmapState>(`${BASE}/baseline`, spec),
  clearReal: () => http.delete<HeatmapState>(`${BASE}/real`),
  mergeReal: () => http.post<HeatmapState>(`${BASE}/real/merge`),
};

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}
