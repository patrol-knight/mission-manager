import type { CSSProperties } from "react";
import styles from "./ProgressTrack.module.css";
import { cx } from "../../components/ui/cx";

/** Beyond this many steps, segments get too thin to read: draw a fill bar. */
const MAX_SEGMENTS = 16;

interface ProgressTrackProps {
  /** Number of steps; null for an open-ended run (infinite loops). */
  total: number | null;
  /** Steps finished. */
  done: number;
  /** "2/9" (or just "3" for an open-ended run), shown at the right. */
  fraction: string;
  /** Spelled out, for the tooltip and screen readers. */
  label: string;
  /** This row's color -- each progress row gets its own shade. */
  color: string;
}

/** One row of mission progress: a segment per step, filled once that step
 * is finished, plus its fraction. Many steps become a fill
 * bar; an open-ended run, a plain track. */
export function ProgressTrack({ total, done, fraction, label, color }: ProgressTrackProps) {
  return (
    <div className={styles.row} style={{ "--progress-color": color } as CSSProperties} data-hint={label} role="img" aria-label={label}>
      <div className={styles.track}>
        {total === null ? (
          <div className={styles.bar} />
        ) : total <= MAX_SEGMENTS ? (
          Array.from({ length: total }, (_, i) => (
            <span key={i} className={cx(styles.segment, i < done && styles.done)} />
          ))
        ) : (
          <div className={styles.bar}>
            <div className={styles.fill} style={{ width: `${(Math.min(done, total) / total) * 100}%` }} />
          </div>
        )}
      </div>
      <span className={styles.fraction}>{fraction}</span>
    </div>
  );
}
