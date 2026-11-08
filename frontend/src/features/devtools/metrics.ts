import type { PingResult } from "./devStore";

export type Level = "ok" | "warn" | "bad" | "idle";

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function recent<T extends { t: number }>(items: T[], sec: number): T[] {
  if (items.length === 0) return items;
  const cutoff = items[items.length - 1].t - sec;
  return items.filter((item) => item.t > cutoff);
}

export interface PingSummary {
  last: number | null;
  p50: number | null;
  p95: number | null;
  lossPct: number | null;
  sent: number;
}

export function summarizePings(pings: PingResult[], sec = 60): PingSummary {
  const window = recent(pings, sec);
  const rtts = window.flatMap((p) => (p.rtt_ms !== null ? [p.rtt_ms] : []));
  const last = window[window.length - 1];
  return {
    last: last ? last.rtt_ms : null,
    p50: percentile(rtts, 50),
    p95: percentile(rtts, 95),
    lossPct: window.length ? (100 * window.filter((p) => p.lost).length) / window.length : null,
    sent: window.length,
  };
}

export function rttLevel(ms: number | null): Level {
  if (ms === null) return "idle";
  return ms > 300 ? "bad" : ms > 100 ? "warn" : "ok";
}

export function lossLevel(pct: number | null): Level {
  if (pct === null) return "idle";
  return pct > 5 ? "bad" : pct > 0 ? "warn" : "ok";
}

export function silentLevel(silent: number | null, expectedHz: number | null): Level {
  if (silent === null || !expectedHz) return "idle";
  const period = 1 / expectedHz;
  return silent > Math.max(3, 10 * period) ? "bad" : silent > Math.max(1, 3 * period) ? "warn" : "ok";
}

export function fmt(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || Number.isNaN(value) ? "–" : value.toFixed(digits);
}
