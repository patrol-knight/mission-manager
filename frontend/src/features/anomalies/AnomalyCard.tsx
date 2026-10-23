import { useEffect, useState } from "react";
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
import { anomalyTitle, isClosed } from "./anomalyTypes";

/** The anomaly the operator clicked on the map: Investigate sends the robot,
 * Cancel just deselects it. Closes itself when the anomaly expires or is
 * resolved. */
export function AnomalyCard() {
  const selectedId = useInvestigationStore((s) => s.selectedAnomalyId);
  const selectAnomaly = useInvestigationStore((s) => s.selectAnomaly);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const blocked = useInvestigationStore((s) => needsVerdict(s.investigation));
  const anomaly = useDeviceStore((s) => (selectedId ? s.anomalies[selectedId] : undefined));
  const robot = useConnectedRobot();
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  const gone = selectedId !== null && (anomaly === undefined || isClosed(anomaly));
  useEffect(() => {
    if (gone) selectAnomaly(null);
  }, [gone, selectAnomaly]);

  if (!anomaly || gone) return null;

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
      aside={anomaly.resolution === "unclear" ? <Pill tone="muted">Unclear</Pill> : undefined}
      aria-label="Selected anomaly"
    >
      <AnomalyInfoRows anomaly={anomaly} />
      <ButtonRow>
        <span style={{ display: "flex" }} title={disabledReason ?? undefined}>
          <Button variant="primary" block onClick={() => void investigate()} disabled={pending || disabledReason !== null}>
            {pending ? "Sending…" : "Investigate"}
          </Button>
        </span>
        <Button block onClick={() => selectAnomaly(null)}>
          Cancel
        </Button>
      </ButtonRow>
    </Card>
  );
}
