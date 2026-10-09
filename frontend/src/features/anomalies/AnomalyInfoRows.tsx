import { useNow, formatAge } from "../../hooks/useNow";
import { formatAnomalyTypes, formatConfidence, shortAnomalyId, type Anomaly } from "./anomalyTypes";

/** The facts an operator weighs before and during an investigation -- shared
 * by AnomalyCard and InvestigateCard. */
export function AnomalyInfoRows({ anomaly, showGrace }: { anomaly: Anomaly; showGrace: boolean }) {
  const now = useNow();
  const graceSec = Math.max(0, Math.round((Date.parse(anomaly.expiresAt) - now) / 1000));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <InfoRow label="Type" value={formatAnomalyTypes(anomaly.types)} />
      <InfoRow label="Confidence" value={formatConfidence(anomaly.confidence)} />
      <InfoRow label="Detected" value={`${formatAge(anomaly.detectedAt, now)} ago`} />
      <InfoRow label="Source" value={anomaly.sourceDeviceId} />
      {showGrace && <InfoRow label="Disappears in" value={`${graceSec} s without refresh`} />}
      {anomaly.resolution === "unclear" && <InfoRow label="Last verdict" value="UNCLEAR" />}
      <InfoRow label="ID" value={shortAnomalyId(anomaly.anomalyId)} title={anomaly.anomalyId} />
    </div>
  );
}

export function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <span style={{ color: "#6c757d" }}>{label}</span>
      <span style={{ color: "#212529", fontWeight: 500, textAlign: "right" }} title={title}>
        {value}
      </span>
    </div>
  );
}
