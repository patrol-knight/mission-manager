import { useNow, formatAge } from "../../hooks/useNow";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { formatAnomalyTypes, formatConfidence, type Anomaly } from "./anomalyTypes";

/** The three facts an operator weighs about an anomaly -- shared by the
 * anomaly card and the investigation card. */
export function AnomalyInfoRows({ anomaly }: { anomaly: Anomaly }) {
  const now = useNow();
  return (
    <InfoList gap={6}>
      <InfoRow label="Type" value={formatAnomalyTypes(anomaly.types)} />
      <InfoRow label="Confidence" value={formatConfidence(anomaly.confidence)} />
      <InfoRow label="Detected" value={`${formatAge(anomaly.detectedAt, now)} ago`} />
    </InfoList>
  );
}
