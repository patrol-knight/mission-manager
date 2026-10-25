import { useContext } from "react";
import { ToastContext, type ToastContextValue } from "./toastContextObject";

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
