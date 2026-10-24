import { useNow, formatAge } from "../../hooks/useNow";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { formatAnomalyTypes, formatConfidence, type Anomaly, type AnomalyType } from "./anomalyTypes";

/** One type per line, for an InfoRow value -- a joined string wraps badly. */
export function AnomalyTypeLines({ types }: { types: AnomalyType[] }) {
  return types.map((t) => (
    <span key={t} style={{ display: "block" }}>
      {formatAnomalyTypes([t])}
    </span>
  ));
}

/** The three facts an operator weighs about an anomaly -- shared by the
 * anomaly card and the investigation card. `expired`: the anomaly is no
 * longer reported, which replaces its age. */
export function AnomalyInfoRows({ anomaly, expired = false }: { anomaly: Anomaly; expired?: boolean }) {
  const now = useNow();
  return (
    <InfoList gap={6}>
      <InfoRow label="Type" value={<AnomalyTypeLines types={anomaly.types} />} />
      <InfoRow label="Confidence" value={formatConfidence(anomaly.confidence)} />
      <InfoRow label="Detected" value={expired ? "No longer detected" : `${formatAge(anomaly.detectedAt, now)} ago`} />
    </InfoList>
  );
}
