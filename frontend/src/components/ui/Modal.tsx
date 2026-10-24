import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Modal.module.css";
import { CloseButton } from "./Button";
import { cx } from "./cx";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  /** `dialog`: small light confirmation box. `fullscreen`: dark window
   * around a camera feed. */
  variant?: "dialog" | "fullscreen";
  /** Whether clicking the dimmed background closes it. Off for the camera
   * windows, where a stray click shouldn't end the stream. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}

/**
 * Mount it to open it, unmount to close. While mounted: focus moves into the
 * dialog, Tab stays inside it, Escape calls onClose, and focus returns to
 * whatever had it before on close.
 */
export function Modal({ label, onClose, variant = "dialog", closeOnBackdrop = false, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus();
    };
  }, []);

  const fullscreen = variant === "fullscreen";
  return (
    <div
      className={cx(styles.backdrop, fullscreen ? cx(styles.fullscreenBackdrop, "theme-dark") : styles.dialogBackdrop)}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={fullscreen ? styles.fullscreen : styles.dialog}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  title: ReactNode;
  /** Shown next to the title (a status, a summary). */
  children?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

/** Title row of a fullscreen Modal, with its close button on the right. */
export function ModalHeader({ title, children, onClose, closeLabel = "Close" }: ModalHeaderProps) {
  return (
    <div className={styles.header}>
      <span className={styles.headerTitle}>{title}</span>
      {children}
      <CloseButton onClick={onClose} aria-label={closeLabel} className={styles.headerClose} />
    </div>
  );
}
