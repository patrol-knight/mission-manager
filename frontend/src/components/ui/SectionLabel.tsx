import type { ReactNode } from "react";

/** Small uppercase label over a group: a panel section ("Mission",
 * "Fleet") or a block inside a card ("Waypoints"). `aside` sits at the right. */
export function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 22 }}>
      <span
        style={{
          fontSize: "var(--text-2xs)",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-text-faint)",
        }}
      >
        {children}
      </span>
      {aside}
    </div>
  );
}
