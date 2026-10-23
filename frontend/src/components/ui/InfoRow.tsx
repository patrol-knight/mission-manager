import type { ReactNode } from "react";
import styles from "./InfoRow.module.css";
import { cx } from "./cx";

interface InfoRowProps {
  label: string;
  value: ReactNode;
  /** Hover text for the value, e.g. a full id behind a shortened one. */
  title?: string;
  /** Smaller text, for dense lists like the mission library. */
  dense?: boolean;
}

/** "Label ........ value" -- the app's standard key/value line. */
export function InfoRow({ label, value, title, dense }: InfoRowProps) {
  return (
    <div className={cx(styles.row, dense && styles.dense)}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value} title={title}>
        {value}
      </span>
    </div>
  );
}

/** Vertical stack of InfoRows; 4px apart unless `gap` says otherwise. */
export function InfoList({ children, gap }: { children: ReactNode; gap?: number }) {
  return (
    <div className={styles.list} style={gap !== undefined ? { gap } : undefined}>
      {children}
    </div>
  );
}
