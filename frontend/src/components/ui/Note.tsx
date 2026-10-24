import type { ReactNode } from "react";
import styles from "./Note.module.css";
import { cx } from "./cx";

interface NoteProps {
  children: ReactNode;
  tone?: "muted" | "danger" | "success" | "caution";
  size?: "sm" | "md";
  className?: string;
}

/** A short line of explanatory or status text: empty states, hints,
 * validation results, field errors. */
export function Note({ children, tone = "muted", size = "md", className }: NoteProps) {
  return <p className={cx(styles.note, styles[tone], size === "sm" && styles.sm, className)}>{children}</p>;
}
