import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerSolid" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `danger` is the outlined destructive button; `dangerSolid` the filled
   * one for a confirm dialog's final "Delete". */
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** Grow to fill the row (or column) it sits in. */
  block?: boolean;
}

export function Button({ variant = "secondary", size = "md", block, className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[size], styles[variant], block && styles.block, className)}
      {...rest}
    />
  );
}

/** The "×" in a card or modal header. */
export function CloseButton({ className, ...rest }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button type="button" className={cx(styles.close, className)} {...rest}>
      ×
    </button>
  );
}
