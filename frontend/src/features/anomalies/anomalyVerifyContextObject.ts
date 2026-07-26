import { createContext } from "react";

export interface AnomalyVerifyContextValue {
  /** The anomaly currently shown in AnomalyVerifyModal, if any. */
  verifyingAnomalyId: string | null;
  open: (anomalyId: string) => void;
  close: () => void;
}

export const AnomalyVerifyContext = createContext<AnomalyVerifyContextValue | null>(null);
