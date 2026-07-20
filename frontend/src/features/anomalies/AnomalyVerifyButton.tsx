import { useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useDeviceInspector } from "../devices/useDeviceInspector";
import { useToast } from "../../components/useToast";
import { verifyAnomaly } from "../../api/anomalyApi";

/** Rendered as the Device Inspector's optional footer action, only when the
 * inspector was opened for anomaly review (see DeviceInspectorContext.anomalyContext). */
export function AnomalyVerifyButton() {
  const { anomalyContext } = useDeviceInspector();
  const anomaly = useDeviceStore((s) => (anomalyContext ? s.anomalies[anomalyContext] : undefined));
  const upsertAnomaly = useDeviceStore((s) => s.upsertAnomaly);
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  if (!anomaly) return null;

  const verified = anomaly.status === "verified";

  const handleVerify = async () => {
    setPending(true);
    try {
      upsertAnomaly(await verifyAnomaly(anomaly.anomalyId));
      show("success", "Anomaly verified");
    } catch (err) {
      show("error", "Verify failed", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleVerify}
      disabled={pending || verified}
      style={{
        padding: "10px 20px",
        borderRadius: 8,
        border: "none",
        background: verified ? "#495057" : "#2f9e44",
        color: "#fff",
        fontWeight: 600,
        fontSize: 14,
        cursor: pending || verified ? "not-allowed" : "pointer",
        opacity: pending ? 0.7 : 1,
      }}
    >
      {verified ? "Verified" : pending ? "Verifying…" : "Verify Anomaly"}
    </button>
  );
}
