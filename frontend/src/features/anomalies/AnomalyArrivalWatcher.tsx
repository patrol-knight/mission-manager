import { useEffect, useRef } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useToast } from "../../components/useToast";

/**
 * Renderless — watches deviceStore's anomalies for a detected -> robot_arrived
 * transition and shows a one-time informational toast. Purely a heads-up:
 * the only way to actually open the verify window is MissionStatusPanel's
 * "Review Anomaly" button, which is always available while an anomaly is at
 * robot_arrived regardless of whether this toast was seen or dismissed.
 */
export function AnomalyArrivalWatcher() {
  const anomalies = useDeviceStore((s) => s.anomalies);
  const { show } = useToast();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const anomaly of Object.values(anomalies)) {
      if (anomaly.status !== "robot_arrived" || notifiedRef.current.has(anomaly.anomalyId)) {
        continue;
      }
      notifiedRef.current.add(anomaly.anomalyId);
      show("warning", "Robot arrived at anomaly location. Verify it.");
    }
  }, [anomalies, show]);

  return null;
}
