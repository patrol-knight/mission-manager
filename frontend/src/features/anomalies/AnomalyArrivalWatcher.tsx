import { useEffect, useRef } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useDeviceInspector } from "../devices/useDeviceInspector";
import { useToast } from "../../components/useToast";

/**
 * Renderless — watches deviceStore's anomalies for a detected -> robot_arrived
 * transition and shows a persistent toast (plan doc §12.3). Mounted once,
 * always active (not gated by monitor/editor view), inside both
 * DeviceInspectorProvider and ToastProvider so it can drive both.
 */
export function AnomalyArrivalWatcher() {
  const anomalies = useDeviceStore((s) => s.anomalies);
  const { openInspectorForAnomaly } = useDeviceInspector();
  const { show, dismiss } = useToast();
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const anomaly of Object.values(anomalies)) {
      if (anomaly.status !== "robot_arrived" || notifiedRef.current.has(anomaly.anomalyId)) {
        continue;
      }
      notifiedRef.current.add(anomaly.anomalyId);

      let toastId = 0;
      toastId = show("warning", "Robot arrived at anomaly location.", undefined, {
        persistent: true,
        actions: [
          {
            label: "Open Robot Inspector",
            onClick: () => {
              if (anomaly.sourceDeviceId) {
                openInspectorForAnomaly(anomaly.sourceDeviceId, anomaly.anomalyId);
              }
              dismiss(toastId);
            },
          },
          { label: "Dismiss", onClick: () => dismiss(toastId) },
        ],
      });
    }
  }, [anomalies, openInspectorForAnomaly, show, dismiss]);

  return null;
}
