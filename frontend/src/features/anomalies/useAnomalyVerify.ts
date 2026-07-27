import { useContext } from "react";
import { AnomalyVerifyContext, type AnomalyVerifyContextValue } from "./anomalyVerifyContextObject";

export function useAnomalyVerify(): AnomalyVerifyContextValue {
  const ctx = useContext(AnomalyVerifyContext);
  if (!ctx) throw new Error("useAnomalyVerify must be used within an AnomalyVerifyProvider");
  return ctx;
}
