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
  | "activate";

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  /** A leading dot, for live states (online, running, ...). */
  dot?: boolean;
  title?: string;
}

/** Small uppercase status label: mission state, robot activity, device
 * connectivity, alert counts, verdicts. */
export function Pill({ children, tone = "neutral", dot, title }: PillProps) {
  return (
    <span className={cx(styles.pill, styles[tone])} title={title}>
      {dot && <span className={styles.dot} />}
      {children}
    </span>
  );
}
