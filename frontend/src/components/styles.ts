import type { CSSProperties } from "react";

/** Shared look for right-panel cards and their buttons. */
export const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

export const cardTitleStyle: CSSProperties = {
  margin: "0 0 12px 0",
  fontSize: 13,
  fontWeight: 600,
  color: "#495057",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const buttonBase: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

export const buttonStyles = {
  primary: { ...buttonBase, background: "#1c7ed6", color: "#fff" },
  danger: { ...buttonBase, background: "#fff", color: "#dc3545", border: "1px solid #f5c6cb" },
  neutral: { ...buttonBase, background: "#fff", color: "#212529", border: "1px solid #dee2e6" },
  warning: { ...buttonBase, background: "#f08c00", color: "#fff" },
} satisfies Record<string, CSSProperties>;

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
  background: "#adb5bd",
  color: "#f1f3f5",
  border: "none",
};

export function withDisabled(style: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...style, ...disabledStyle } : style;
}
