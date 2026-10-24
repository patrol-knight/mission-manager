import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal label={title} onClose={onCancel} closeOnBackdrop>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--color-text)" }}>{title}</div>
      {message && <div style={{ fontSize: "var(--text-md)", color: "var(--color-text-muted)" }}>{message}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>{cancelLabel}</Button>
        <Button variant="dangerSolid" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
