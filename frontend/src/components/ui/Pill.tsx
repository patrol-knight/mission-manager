import type { ReactNode } from "react";
import styles from "./Pill.module.css";
import { cx } from "./cx";

export type PillTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "muted"
  // Mode colors (see tokens.css): running a mission, investigating, editing.
  | "mission"
  | "missionSoft"
  | "investigate"
  | "edit"
  | "activate"
  // The verify window's UNCLEAR grey, translucent -- for neutral counts and
  // small buttons that shouldn't read as a status.
  | "subtle";

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  /** A leading dot, for live states (online, running, ...). */
  dot?: boolean;
  title?: string;
  className?: string;
}

/** Small uppercase status label: mission state, robot activity, device
 * connectivity, alert counts, verdicts. */
/** A pill that does something (e.g. "View" on a tower row): the same shape
 * and type as the status pills beside it, so a row reads as one set. */
export function PillButton({
  children,
  tone = "neutral",
  hint,
  className,
  ...rest
}: {
  children: ReactNode;
  tone?: PillTone;
  hint?: string;
  className?: string;
  onClick: () => void;
  "aria-label"?: string;
}) {
  return (
    <button type="button" className={cx(styles.pill, styles[tone], styles.button, className)} data-hint={hint} {...rest}>
      {children}
    </button>
  );
}

export function Pill({ children, tone = "neutral", dot, title, className }: PillProps) {
  return (
    <span className={cx(styles.pill, styles[tone], className)} data-hint={title}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
