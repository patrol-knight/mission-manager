import { createContext } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Persistent toasts never auto-dismiss — only an explicit action/click removes them. */
  persistent?: boolean;
  actions?: ToastAction[];
}

export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  subtitle?: string;
  persistent?: boolean;
  actions?: ToastAction[];
}

export interface ToastContextValue {
  /** Returns the new toast's id — useful for an action that should dismiss itself. */
  show: (type: ToastType, title: string, subtitle?: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  show: () => -1,
  dismiss: () => {},
});
