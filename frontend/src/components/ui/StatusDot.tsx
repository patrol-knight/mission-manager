import type { AriaRole } from "react";
import { statusColor, type DotStatus } from "./status";

interface StatusDotProps {
  status: DotStatus;
  size?: number;
  role?: AriaRole;
  "aria-label"?: string;
}

export function StatusDot({ status, size = 8, ...aria }: StatusDotProps) {
  return (
    <span
      {...aria}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: statusColor(status),
        flexShrink: 0,
      }}
    />
  );
}
