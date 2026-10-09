import { useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { cardStyle, cardTitleStyle, buttonStyles, withDisabled } from "../../components/styles";
import { useNow, formatAge } from "../../hooks/useNow";
import { stopInvestigation } from "../../api/investigationApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { AnomalyInfoRows, InfoRow } from "../anomalies/AnomalyInfoRows";
import { VERDICT_COLORS, VERDICT_LABELS, type AnomalyVerdict } from "../anomalies/anomalyTypes";
import { fallbackAfterInvestigation } from "./fallback";
import type { Investigation } from "./investigationTypes";

/** Top of the right panel while investigating. Keyed by anomaly so switching
 * targets mounts a fresh card (slide-in). */
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
  const robot = useConnectedRobot();
  const { show } = useToast();
  const now = useNow();
  const [pending, setPending] = useState(false);

  const onSite = investigation.phase === "on_site";
  const distanceM = robot
    ? Math.hypot(robot.pose.x - investigation.target.x, robot.pose.y - investigation.target.y)
    : null;

  const fallback = fallbackAfterInvestigation(execution, definition);
  const verdict = investigation.draftVerdict;

  // No confirm dialog: Stop/Finish act at once, and the toast says what was
  // recorded and where the robot goes next.
  const end = async () => {
    const recorded = onSite && verdict ? `Recorded as ${VERDICT_LABELS[verdict]}` : "Investigation stopped";
    setPending(true);
    try {
      await stopInvestigation();
      setInvestigation(null);
      show("info", recorded, fallback.doneMessage);
    } catch (err) {
      show("error", onSite ? "Finish failed" : "Stop failed", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card-enter" style={{ ...cardStyle, borderTop: "4px solid #f08c00" }} aria-label="Investigation">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={cardTitleStyle}>{onSite ? "Investigating · on site" : "Investigating · en route"}</h3>
        <VerdictChip verdict={verdict} visible={onSite} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {distanceM !== null && !onSite && <InfoRow label="Distance" value={`${Math.round(distanceM)} m`} />}
        <InfoRow label="Elapsed" value={formatAge(investigation.startedAt, now)} />
        {anomaly && <AnomalyInfoRows anomaly={anomaly} showGrace={false} />}
      </div>


      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        {onSite ? (
          <>
            <div style={{ display: "flex" }}>
              <button onClick={openVerify} style={buttonStyles.warning}>
                Verify
              </button>
            </div>
            <div style={{ display: "flex" }} title={verdict ? undefined : "Choose a verdict in Verify first"}>
              <button
                className="card-enter"
                onClick={() => void end()}
                disabled={pending || verdict === null}
                style={withDisabled(buttonStyles.primary, pending || verdict === null)}
              >
                Finish
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex" }}>
            <button onClick={() => void end()} disabled={pending} style={withDisabled(buttonStyles.danger, pending)}>
              Stop
            </button>
          </div>
        )}
      </div>

    </div>
  );
}

function VerdictChip({ verdict, visible }: { verdict: AnomalyVerdict | null; visible: boolean }) {
  if (!visible) return null;
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 8px",
        borderRadius: 999,
        color: "#fff",
        background: verdict ? VERDICT_COLORS[verdict] : "#adb5bd",
      }}
    >
      {verdict ? VERDICT_LABELS[verdict] : "NOT VERIFIED"}
    </span>
  );
}
