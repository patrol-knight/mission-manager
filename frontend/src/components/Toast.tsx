import * as React from "react";
import { ToastContext, type ToastMessage, type ToastOptions, type ToastType } from "./toastContextObject";

/** Each toast type's accent: the bar on the toast's left edge. */
const ACCENTS: Record<ToastType, string> = {
  success: "var(--color-success)",
  error: "var(--color-danger)",
  info: "var(--color-primary)",
  warning: "var(--color-warning)",
};

const DURATION = 3000;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const accent = ACCENTS[toast.type];

  React.useEffect(() => {
    const show = requestAnimationFrame(() =>
      requestAnimationFrame(() => setVisible(true))
    );
    if (toast.persistent) {
      return () => cancelAnimationFrame(show);
    }
    const hide = setTimeout(() => setVisible(false), DURATION);
    const remove = setTimeout(() => onDismiss(toast.id), DURATION + 400);

    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, [toast.id, toast.persistent, onDismiss]);

  return (
    <div
      onClick={() => {
        if (toast.persistent) return; // persistent toasts only close via an explicit action
        setVisible(false);
        setTimeout(() => onDismiss(toast.id), 400);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "color-mix(in srgb, var(--color-surface-raised) 94%, transparent)",
        backdropFilter: "blur(12px)",
        border: "1px solid var(--color-border-strong)",
        borderRadius: "var(--radius-md)",
        padding: "12px 16px 12px 12px",
        cursor: toast.persistent ? "default" : "pointer",
        boxShadow: "var(--shadow-floating)",
        minWidth: 280,
        maxWidth: 360,
        transform: visible ? "translateY(0)" : "translateY(-110%)",
        opacity: visible ? 1 : 0,
        transition:
          "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease",
        userSelect: "none",
      }}
    >
      <div style={{ alignSelf: "stretch", width: 3, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text)" }}>
          {toast.title}
        </div>
        {toast.subtitle && (
          <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)", marginTop: 2 }}>
            {toast.subtitle}
          </div>
        )}
        {toast.actions && toast.actions.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {toast.actions.map((action, i) => (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  action.onClick();
                }}
                style={{
                  padding: "6px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--color-border-strong)",
                  background: i === 0 ? "var(--color-surface-hover)" : "transparent",
                  color: "var(--color-text)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const counter = React.useRef(0);

  const show = React.useCallback(
    (type: ToastType, title: string, subtitle?: string, options?: ToastOptions): number => {
      const id = ++counter.current;
      setToasts((prev) => [
        ...prev,
        { id, type, title, subtitle, persistent: options?.persistent, actions: options?.actions },
      ]);
      return id;
    },
    []
  );

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: "fixed",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          zIndex: "var(--z-toast)",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div key={t.id} style={{ pointerEvents: "auto" }}>
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
