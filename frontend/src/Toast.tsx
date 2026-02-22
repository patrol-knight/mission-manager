import * as React from "react";

export type ToastType = "success" | "error" | "info";

export type ToastMessage = {
  id: number;
  type: ToastType;
  title: string;
  subtitle?: string;
};

type ToastItemProps = {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
};

const COLORS: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: {
    bg: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)",
    icon: "✓",
    border: "rgba(56, 239, 125, 0.3)",
  },
  error: {
    bg: "linear-gradient(135deg, #c0392b 0%, #e74c3c 100%)",
    icon: "✕",
    border: "rgba(231, 76, 60, 0.3)",
  },
  info: {
    bg: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    icon: "↑",
    border: "rgba(102, 126, 234, 0.3)",
  },
};

const DURATION = 2500; // ms before auto-dismiss

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = React.useState(false);
  const color = COLORS[toast.type];

  // Slide in on mount
  React.useEffect(() => {
    const showTimer = requestAnimationFrame(() => {
      requestAnimationFrame(() => setVisible(true));
    });

    // Auto dismiss
    const hideTimer = setTimeout(() => {
      setVisible(false);
    }, DURATION);

    const removeTimer = setTimeout(() => {
      onDismiss(toast.id);
    }, DURATION + 400); // wait for slide-out animation

    return () => {
      cancelAnimationFrame(showTimer);
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, onDismiss]);

  return (
    <div
      onClick={() => {
        setVisible(false);
        setTimeout(() => onDismiss(toast.id), 400);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "rgba(20, 20, 30, 0.92)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${color.border}`,
        borderRadius: 12,
        padding: "14px 18px",
        cursor: "pointer",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
        minWidth: 280,
        maxWidth: 360,
        transform: visible ? "translateY(0)" : "translateY(-110%)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease",
        userSelect: "none",
      }}
    >
      {/* Icon badge */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: color.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontWeight: 700,
          color: "white",
          flexShrink: 0,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        {color.icon}
      </div>

      {/* Text */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#f8f9fa" }}>
          {toast.title}
        </div>
        {toast.subtitle && (
          <div style={{ fontSize: 12, color: "#adb5bd", marginTop: 2 }}>
            {toast.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Context ──────────────────────────────────────────────────────────────────

type ToastContextValue = {
  show: (type: ToastType, title: string, subtitle?: string) => void;
};

const ToastContext = React.createContext<ToastContextValue>({
  show: () => {},
});

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);
  const counterRef = React.useRef(0);

  const show = React.useCallback(
    (type: ToastType, title: string, subtitle?: string) => {
      const id = ++counterRef.current;
      setToasts((prev) => [...prev, { id, type, title, subtitle }]);
    },
    []
  );

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}

      {/* Toast container — top center */}
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
          zIndex: 99999,
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