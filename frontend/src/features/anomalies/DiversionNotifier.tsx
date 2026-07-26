import { useEffect, useRef } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useToast } from "../../components/useToast";

/**
 * Renderless — watches deviceStore's diversion phase for outbound/returning
 * transitions and shows a toast for each (see backend
 * core/anomaly_response.py). Mounted once in AppShell, always active, same
 * pattern as AnomalyArrivalWatcher.
 */
export function DiversionNotifier() {
  const diversion = useDeviceStore((s) => s.diversion);
  const anomalies = useDeviceStore((s) => s.anomalies);
  const { show } = useToast();
  const lastNotifiedRef = useRef<{ anomalyId: string | null; phase: string }>({
    anomalyId: null,
    phase: "none",
  });

  useEffect(() => {
    const last = lastNotifiedRef.current;
    if (last.anomalyId === diversion.anomalyId && last.phase === diversion.phase) {
      return;
    }
    lastNotifiedRef.current = { anomalyId: diversion.anomalyId, phase: diversion.phase };

    if (diversion.phase === "outbound" && diversion.anomalyId) {
      const anomaly = anomalies[diversion.anomalyId];
      const location = anomaly ? ` at (${anomaly.x.toFixed(1)}, ${anomaly.y.toFixed(1)})` : "";
      show("warning", `Robot diverting to anomaly${location}`);
    } else if (diversion.phase === "returning") {
      // One toast for the whole "resolved -> heading back" event, rather
      // than this plus a separate verify/dismiss success toast firing
      // back to back for what's really one thing happening.
      show("info", "Anomaly resolved — robot returning to mission");
    }
  }, [diversion, anomalies, show]);

  return null;
}
