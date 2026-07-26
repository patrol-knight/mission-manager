import { useCallback, useState, type ReactNode } from "react";
import { AnomalyVerifyContext } from "./anomalyVerifyContextObject";

/** Deliberately separate from DeviceInspectorProvider -- anomaly
 * verification is its own concern (see AnomalyVerifyModal), not a mode of
 * the general device inspector. */
export function AnomalyVerifyProvider({ children }: { children: ReactNode }) {
  const [verifyingAnomalyId, setVerifyingAnomalyId] = useState<string | null>(null);

  const open = useCallback((anomalyId: string) => setVerifyingAnomalyId(anomalyId), []);
  const close = useCallback(() => setVerifyingAnomalyId(null), []);

  return (
    <AnomalyVerifyContext.Provider value={{ verifyingAnomalyId, open, close }}>
      {children}
    </AnomalyVerifyContext.Provider>
  );
}
