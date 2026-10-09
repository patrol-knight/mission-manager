import { useEffect, useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { cardStyle, cardTitleStyle, buttonStyles, withDisabled } from "../../components/styles";
import { startInvestigation } from "../../api/investigationApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { needsVerdict } from "../investigation/investigationTypes";
import { AnomalyInfoRows } from "./AnomalyInfoRows";
import { isClosed } from "./anomalyTypes";

/** The anomaly the operator clicked on the map, with an Investigate button.
 * Closes itself when the anomaly expires or is resolved. */
export function AnomalyCard() {
  const selectedId = useInvestigationStore((s) => s.selectedAnomalyId);
  const selectAnomaly = useInvestigationStore((s) => s.selectAnomaly);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const blocked = useInvestigationStore((s) => needsVerdict(s.investigation));
  const investigating = useInvestigationStore((s) => s.investigation !== null);
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
    <div className="card-enter" style={cardStyle} aria-label="Selected anomaly">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={cardTitleStyle}>Anomaly</h3>
        <button
          onClick={() => selectAnomaly(null)}
          aria-label="Close anomaly card"
          style={{ border: "none", background: "none", fontSize: 18, lineHeight: 1, color: "#868e96", cursor: "pointer" }}
        >
          ×
        </button>
      </div>
      <AnomalyInfoRows anomaly={anomaly} showGrace />
      <div style={{ display: "flex", marginTop: 12 }} title={disabledReason ?? undefined}>
        <button
          onClick={() => void investigate()}
          disabled={pending || disabledReason !== null}
          style={withDisabled(buttonStyles.warning, pending || disabledReason !== null)}
        >
          {pending ? "Sending robot…" : investigating ? "Investigate this instead" : "Investigate"}
        </button>
      </div>
    </div>
  );
}
