import { useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { Pill, type PillTone } from "../../components/ui/Pill";
import { stopInvestigation } from "../../api/investigationApi";
import { AnomalyInfoRows } from "../anomalies/AnomalyInfoRows";
import { anomalyTitle, VERDICT_LABELS, type AnomalyVerdict } from "../anomalies/anomalyTypes";
import { fallbackAfterInvestigation } from "./fallback";
import type { Investigation } from "./investigationTypes";

const VERDICT_TONES: Record<AnomalyVerdict, PillTone> = {
  true_positive: "danger",
  false_positive: "success",
  unclear: "muted",
};

/** The anomaly the robot is investigating. Its phase (en route / on site) is
 * on the robot's status pill; this card carries the verdict. Keyed by
 * anomaly, so switching targets slides a fresh card in. */
export function InvestigateCard() {
  const investigation = useInvestigationStore((s) => s.investigation);
  if (!investigation) return null;
  return <InvestigateCardBody key={investigation.anomalyId} investigation={investigation} />;
}

function InvestigateCardBody({ investigation }: { investigation: Investigation }) {
  const anomaly = useDeviceStore((s) => s.anomalies[investigation.anomalyId]);
  const execution = useMissionStore((s) => s.execution);
  const definition = useMissionStore((s) => s.definition);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const openVerify = useInvestigationStore((s) => s.openVerify);
  const { show } = useToast();
  const [pending, setPending] = useState(false);

  const onSite = investigation.phase === "on_site";
  const verdict = investigation.draftVerdict;
  const fallback = fallbackAfterInvestigation(execution, definition);

  // No confirm dialog: Stop/Submit act at once, and the toast says what was
  // recorded and where the robot goes next.
  const end = async () => {
    const recorded = onSite && verdict ? `Recorded as ${VERDICT_LABELS[verdict]}` : "Investigation stopped";
    setPending(true);
    try {
      await stopInvestigation();
      setInvestigation(null);
      show("info", recorded, fallback.doneMessage);
    } catch (err) {
      show("error", onSite ? "Submit failed" : "Stop failed", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      enter
      title={anomalyTitle(investigation.anomalyId)}
      aside={verdict ? <Pill tone={VERDICT_TONES[verdict]}>{VERDICT_LABELS[verdict]}</Pill> : undefined}
      aria-label="Investigation"
    >
      {anomaly && <AnomalyInfoRows anomaly={anomaly} />}
      <ButtonRow>
        {onSite ? (
          <>
            <Button variant="primary" block onClick={openVerify}>
              Verify
            </Button>
            <span
              style={{ display: "flex" }}
              data-hint={verdict ? `Then: ${fallback.nextLabel}` : "Choose a verdict in Verify first"}
            >
              <Button block onClick={() => void end()} disabled={pending || verdict === null}>
                Submit
              </Button>
            </span>
          </>
        ) : (
          <Button variant="danger" block onClick={() => void end()} disabled={pending}>
            Stop
          </Button>
        )}
      </ButtonRow>
    </Card>
  );
}
