import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Card.module.css";
import { cx } from "./cx";

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The card's subject, e.g. a mission name or "Anomaly-1a2b3c4d". */
  title?: ReactNode;
  /** Rendered at the right of the title row (a status pill). */
  aside?: ReactNode;
  /** Tighter padding, for one-line strips. */
  compact?: boolean;
  /** Highlighted border, e.g. the selected mission in the library. */
  selected?: boolean;
  /** Border in the current mode's color (see .mode-* in tokens.css). */
  accent?: boolean;
  /** Slide in from below on mount (see .card-enter in index.css). */
  enter?: boolean;
  /** Makes the whole card a button. */
  onClick?: () => void;
}

/** The right panel's basic building block. */
export function Card({
  title,
  aside,
  compact,
  selected,
  accent,
  enter,
  onClick,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = cx(
    styles.card,
    compact && styles.compact,
    selected && styles.selected,
    accent && styles.accent,
    onClick && styles.interactive,
    enter && "card-enter",
    className,
  );
  const content = (
    <>
      {(title !== undefined || aside !== undefined) && (
        <div className={styles.header}>
          {title !== undefined && <h3 className={styles.title}>{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} {...rest}>
      {content}
    </div>
  );
}
