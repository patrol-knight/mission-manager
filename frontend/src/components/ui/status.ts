export type DotStatus = "online" | "connecting" | "offline" | "unknown";

const STATUS_COLOR: Record<DotStatus, string> = {
  online: "var(--color-status-online)",
  connecting: "var(--color-status-connecting)",
  offline: "var(--color-status-offline)",
  unknown: "var(--color-status-unknown)",
};

/** CSS color for a status -- for a StatusDot, or text that should match it. */
export function statusColor(status: DotStatus): string {
  return STATUS_COLOR[status];
}
