import { useState, type CSSProperties } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { setVerdict } from "../../api/investigationApi";
import { useCameraSession } from "../devices/useCameraSession";
import { CameraStreamView } from "../cameras/CameraStreamView";
import { Modal, ModalHeader } from "../../components/ui/Modal";
import { Note } from "../../components/ui/Note";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { cx } from "../../components/ui/cx";
import { useNow, formatAge } from "../../hooks/useNow";
import layout from "../cameras/CameraWindow.module.css";
import styles from "./VerifyModal.module.css";
import {
  formatAnomalyTypes,
  formatConfidence,
  VERDICT_COLORS,
  VERDICT_LABELS,
  type AnomalyVerdict,
} from "../anomalies/anomalyTypes";
import type { Investigation } from "./investigationTypes";

const VERDICTS: AnomalyVerdict[] = ["true_positive", "false_positive", "unclear"];
const VERDICT_HINTS: Record<AnomalyVerdict, string> = {
  true_positive: "Real event",
  false_positive: "False alarm",
  unclear: "Can't tell",
};

/** A live camera -- the robot's, or the reporting tower's for a second
 * angle -- the anomaly's facts, and the TRUE / FALSE / UNCLEAR choice. Each
 * pick is saved immediately as a draft; nothing is final until Finish. The
 * window can be closed and reopened (Verify button) any time while on site. */
export function VerifyModal() {
  const investigation = useInvestigationStore((s) => s.investigation);
  const verifyOpen = useInvestigationStore((s) => s.verifyOpen);
  if (!verifyOpen || investigation?.phase !== "on_site") return null;
  // Mounted only while open, so the camera stream starts and stops with it.
  return <VerifyDialog investigation={investigation} />;
}

function VerifyDialog({ investigation }: { investigation: Investigation }) {
  const closeVerify = useInvestigationStore((s) => s.closeVerify);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const anomaly = useDeviceStore((s) => s.anomalies[investigation.anomalyId]);
  const robotName = useDeviceStore((s) => s.devices[investigation.robotDeviceId]?.name ?? investigation.robotDeviceId);
  const sourceId = anomaly?.sourceDeviceId ?? null;
  const sourceName = useDeviceStore((s) => (sourceId ? (s.devices[sourceId]?.name ?? sourceId) : null));
  // Whose camera the stage shows: the robot's (on site, the closest look) or
  // the tower's that reported it (the original angle). One stream at a time.
  const [view, setView] = useState<"robot" | "source">("robot");
  const cameraDeviceId = view === "source" && sourceId ? sourceId : investigation.robotDeviceId;
  const { camera, stream, error } = useCameraSession(cameraDeviceId, true);
  const { show } = useToast();
  const now = useNow();
  const [pending, setPending] = useState<AnomalyVerdict | null>(null);

  const choose = async (verdict: AnomalyVerdict) => {
    if (verdict === investigation.draftVerdict) return;
    setPending(verdict);
    try {
      setInvestigation(await setVerdict(verdict));
    } catch (err) {
      show("error", "Couldn't save the verdict", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(null);
    }
  };

  return (
    <Modal label="Verify anomaly" onClose={closeVerify} variant="fullscreen">
      <ModalHeader title={`Verify Anomaly ${investigation.anomalyId}`} onClose={closeVerify} />
      <div className={layout.body}>
        <div className={layout.stage}>
          {sourceId && (
            <div className={layout.switcher} role="tablist" aria-label="Camera">
              <SwitchButton on={view === "robot"} onClick={() => setView("robot")} name={robotName} role="Robot" />
              <SwitchButton on={view === "source"} onClick={() => setView("source")} name={sourceName ?? sourceId} role="Source" />
            </div>
          )}
          <div className={layout.feed}>
            {error ? <Note tone="danger">{error}</Note> : <CameraStreamView camera={camera} stream={stream} />}
          </div>
        </div>

        <aside className={layout.sidebar}>
          <section className={layout.section}>
            <h3 className={layout.sectionTitle}>Anomaly</h3>
            <InfoList gap={8}>
              {anomaly && (
                <>
                  <InfoRow label="Type" value={formatAnomalyTypes(anomaly.types)} />
                  <InfoRow label="Confidence" value={formatConfidence(anomaly.confidence)} />
                  <InfoRow label="Detected" value={`${formatAge(anomaly.detectedAt, now)} ago`} />
                  <InfoRow label="Source" value={sourceName ?? anomaly.sourceDeviceId} />
                </>
              )}
            </InfoList>
          </section>

          <section className={cx(layout.section, layout.footer)}>
            <h3 className={layout.sectionTitle}>Verdict</h3>
            <div className={styles.verdicts}>
              {VERDICTS.map((verdict) => {
                const selected = investigation.draftVerdict === verdict;
                return (
                  <button
                    key={verdict}
                    type="button"
                    onClick={() => void choose(verdict)}
                    disabled={pending !== null}
                    aria-pressed={selected}
                    className={cx(styles.verdict, selected && styles.selected)}
                    style={{ "--verdict-color": VERDICT_COLORS[verdict] } as CSSProperties}
                  >
                    <span className={styles.dot} />
                    <span className={styles.label}>{pending === verdict ? "Saving…" : VERDICT_LABELS[verdict]}</span>
                    <span className={styles.hint}>{VERDICT_HINTS[verdict]}</span>
                  </button>
                );
              })}
            </div>
            <Note size="sm">Saved as a draft. It's recorded when you press Finish.</Note>
          </section>
        </aside>
      </div>
    </Modal>
  );
}

function SwitchButton({ on, onClick, name, role }: { on: boolean; onClick: () => void; name: string; role: string }) {
  return (
    <button type="button" role="tab" aria-selected={on} className={cx(layout.switch, on && layout.switchOn)} onClick={onClick}>
      {name}
      <span className={layout.switchRole}>{role}</span>
    </button>
  );
}
