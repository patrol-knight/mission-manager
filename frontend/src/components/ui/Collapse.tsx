import type { ReactNode } from "react";
import styles from "./Collapse.module.css";
import { cx } from "./cx";

/** Animates its content's height (and fade) between open and closed. The
 * content stays mounted, so it can animate both ways; `inert` keeps a
 * closed one out of the tab order. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={cx(styles.collapse, !open && styles.closed)} aria-hidden={!open} inert={!open}>
      <div className={styles.inner}>{children}</div>
    </div>
  );
}
