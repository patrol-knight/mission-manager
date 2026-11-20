import { useNow, formatAge } from "../../hooks/useNow";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { useDeviceStore } from "../../stores/deviceStore";
import { cameraHealthReasons, formatReasons } from "../devices/towers";
import { formatAnomalyTypes, formatConfidence, isCameraUnhealthy, type Anomaly } from "./anomalyTypes";

/** The three facts an operator weighs about an anomaly -- shared by the
 * anomaly card and the investigation card. `expired`: the anomaly is no
 * longer reported, which replaces its age. A camera fault's confidence is
 * always 1, so its row shows the reasons instead. */
export function AnomalyInfoRows({ anomaly, expired = false }: { anomaly: Anomaly; expired?: boolean }) {
  const now = useNow();
  return (
    <InfoList gap={6}>
      <InfoRow label="Type" value={formatAnomalyTypes(anomaly.types)} />
      {isCameraUnhealthy(anomaly) ? (
        <ReasonRow deviceId={anomaly.sourceDeviceId} />
      ) : (
        <InfoRow label="Confidence" value={formatConfidence(anomaly.confidence)} />
      )}
      <InfoRow label="Detected" value={expired ? "No longer detected" : `${formatAge(anomaly.detectedAt, now)} ago`} />
    </InfoList>
  );
}

export function ReasonRow({ deviceId }: { deviceId: string }) {
  const device = useDeviceStore((s) => s.devices[deviceId]);
  const reasons = cameraHealthReasons(device);
  const text = formatReasons(reasons);
  const full = reasons?.join(", ");
  return <InfoRow label="Reason" value={text} title={full && full !== text ? full : undefined} />;
}
