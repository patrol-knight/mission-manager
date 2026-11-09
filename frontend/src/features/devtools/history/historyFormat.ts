import type { Verdict } from "./historyApi";

export const VERDICTS: [Verdict, string, string][] = [
  ["true_positive", "True", "var(--color-verdict-true)"],
  ["unclear", "Unclear", "var(--color-verdict-unclear)"],
  ["expired", "Expired", "var(--color-text-faint)"],
  ["false_positive", "False", "var(--color-verdict-false)"],
];

export function formatDuration(fromIso: string, toIso: string | null): string {
  if (!toIso) return "";
  const min = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function formatAgo(iso: string, now = Date.now()): string {
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Request failed";
}
