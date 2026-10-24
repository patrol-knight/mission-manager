import { useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { Pill } from "../../components/ui/Pill";
import { startInvestigation } from "../../api/investigationApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { needsVerdict } from "../investigation/investigationTypes";
import { AnomalyInfoRows } from "./AnomalyInfoRows";
import { anomalyTitle, isClosed, type Anomaly } from "./anomalyTypes";

/** The anomaly the operator clicked on the map: Investigate sends the robot,
 * Cancel just deselects it. The card stays put while it's open: if the
 * anomaly expires or someone else resolves it meanwhile, the card keeps its
 * last details, marks it Expired / Resolved, and only offers Dismiss -- it never vanishes under
 * the operator's cursor. */
export function AnomalyCard() {
  const selectedId = useInvestigationStore((s) => s.selectedAnomalyId);
  const selectAnomaly = useInvestigationStore((s) => s.selectAnomaly);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const blocked = useInvestigationStore((s) => needsVerdict(s.investigation));
  const live = useDeviceStore((s) => (selectedId ? s.anomalies[selectedId] : undefined));
  const robot = useConnectedRobot();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  // The last version seen of the selected anomaly, shown once it's gone.
  const [lastSeen, setLastSeen] = useState<Anomaly | null>(null);
  if (live && live !== lastSeen) setLastSeen(live);
  const anomaly = live ?? (lastSeen?.anomalyId === selectedId ? lastSeen : null);
  if (!anomaly) return null;

  const ended = !live ? "expired" : isClosed(live) ? "resolved" : null;
  const disabledReason = !robot
    ? "The robot is offline"
    : blocked
      ? "Verify the current anomaly first"
      : null;

  const investigate = async () => {
    setPending(true);
    try {
      setInvestigation(await startInvestigation(anomaly.anomalyId));
    } catch (err) {
      show("error", "Couldn't start the investigation", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      key={anomaly.anomalyId}
      enter
      title={anomalyTitle(anomaly.anomalyId)}
      aside={
        ended ? (
          <Pill tone="muted">{ended === "expired" ? "Expired" : "Resolved"}</Pill>
        ) : anomaly.resolution === "unclear" ? (
          <Pill tone="muted">Unclear</Pill>
        ) : undefined
      }
      aria-label="Selected anomaly"
    >
      <AnomalyInfoRows anomaly={anomaly} expired={ended === "expired"} />
      {ended ? (
        <ButtonRow>
          <Button block onClick={() => selectAnomaly(null)}>
            Dismiss
          </Button>
        </ButtonRow>
      ) : (
        <ButtonRow>
          <span style={{ display: "flex" }} data-hint={disabledReason ?? undefined}>
            <Button variant="primary" block onClick={() => void investigate()} disabled={pending || disabledReason !== null}>
              {pending ? "Sending…" : "Investigate"}
            </Button>
          </span>
          <Button block onClick={() => selectAnomaly(null)}>
            Cancel
          </Button>
        </ButtonRow>
      )}
    </Card>
  );
}
