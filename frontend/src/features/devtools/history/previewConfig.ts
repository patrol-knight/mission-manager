import type { HeatmapDefaults, SourceFilter } from "./historyApi";

export type Model = "demand" | "density";

export interface PreviewState {
  model: Model;
  source: SourceFilter;
  include_excluded: boolean;
  half_life_days: number;
  demand_bandwidth_m: number;
  prior_hours: number;
  floor_per_hour: number;
  ceiling_per_hour: number;
  per_device: boolean;
  density_bandwidth_m: number;
  use_confidence: boolean;
  w_true_positive: number;
  w_unclear: number;
  w_expired: number;
  w_false_positive: number;
  opacity: number;
  show_points: boolean;
}

/** Starts from what the backend runs with, so the preview matches the mission editor. */
export function defaultState(server: HeatmapDefaults): PreviewState {
  return {
    model: "demand",
    source: server.sources.length > 1 ? "all" : server.sources[0],
    include_excluded: false,
    half_life_days: server.half_life_days,
    demand_bandwidth_m: server.bandwidth_m,
    prior_hours: server.prior_hours,
    floor_per_hour: server.floor_per_hour,
    ceiling_per_hour: server.ceiling_per_hour,
    per_device: true,
    density_bandwidth_m: 7.5,
    use_confidence: true,
    w_true_positive: 1,
    w_unclear: 0.7,
    w_expired: 0.5,
    w_false_positive: 0.05,
    opacity: 0.6,
    show_points: false,
  };
}

export function heatmapQuery(s: PreviewState): Record<string, string | number | boolean> {
  const common = { model: s.model, source: s.source, include_excluded: s.include_excluded, half_life_days: s.half_life_days };
  if (s.model === "demand") {
    return {
      ...common,
      bandwidth_m: s.demand_bandwidth_m,
      prior_hours: s.prior_hours,
      floor_per_hour: s.floor_per_hour,
      ceiling_per_hour: s.ceiling_per_hour,
      per_device: s.per_device,
    };
  }
  return {
    ...common,
    bandwidth_m: s.density_bandwidth_m,
    use_confidence: s.use_confidence,
    w_true_positive: s.w_true_positive,
    w_unclear: s.w_unclear,
    w_expired: s.w_expired,
    w_false_positive: s.w_false_positive,
  };
}

/** Root .env lines for the mission editor's heatmap (demand model only). */
export function envLines(s: PreviewState): string {
  const sources = s.source === "all" ? "sim,real" : s.source;
  return [
    `HEATMAP_SOURCES=${sources}`,
    `HEATMAP_BANDWIDTH_M=${s.demand_bandwidth_m}`,
    `HEATMAP_HALF_LIFE_DAYS=${s.half_life_days}`,
    `HEATMAP_PRIOR_HOURS=${s.prior_hours}`,
    `HEATMAP_SCALE_FLOOR=${s.floor_per_hour}`,
    `HEATMAP_SCALE_CEILING=${s.ceiling_per_hour}`,
  ].join("\n");
}

export function formatRate(v: number): string {
  return v >= 1 ? v.toFixed(1) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3);
}
