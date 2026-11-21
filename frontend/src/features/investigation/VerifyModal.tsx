import { useState, type CSSProperties, type ReactNode } from "react";
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
import { ReasonRow } from "../anomalies/AnomalyInfoRows";

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
  if (investigation.kind === "explore") return <ExploreDialog investigation={investigation} />;
  if (!investigation.anomalyId) return null;
  if (investigation.kind === "camera") return <CameraCheckDialog investigation={investigation} anomalyId={investigation.anomalyId} />;
  return <VerifyDialog investigation={investigation} anomalyId={investigation.anomalyId} />;
}

function VerifyDialog({ investigation, anomalyId }: { investigation: Investigation; anomalyId: string }) {
  const closeVerify = useInvestigationStore((s) => s.closeVerify);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const anomaly = useDeviceStore((s) => s.anomalies[anomalyId]);
  const sourceId = anomaly?.sourceDeviceId ?? null;
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
      <ModalHeader title={`Verify Anomaly ${anomalyId}`} onClose={closeVerify} />
      <div className={layout.body}>
        <div className={layout.stage}>
          {sourceId && (
            <div className={layout.switcher} role="tablist" aria-label="Camera">
              <SwitchButton on={view === "robot"} onClick={() => setView("robot")} name={investigation.robotDeviceId} role="Robot" />
              <SwitchButton on={view === "source"} onClick={() => setView("source")} name={sourceId} role="Source" />
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
                  <InfoRow label="Source" value={anomaly.sourceDeviceId} />
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

/** The window on site when there is nothing to verify: the robot's cameras
 * (three, picked from thumbnails), and through the switcher a tower's own
 * when there is one to compare with. No action here: the investigation
 * card's Back to route / Done ends it. */
function ObserveDialog({
  investigation,
  title,
  sourceId,
  section,
  note,
  children,
}: {
  investigation: Investigation;
  title: string;
  sourceId: string | null;
  section: string;
  note: string;
  children: ReactNode;
}) {
  const closeVerify = useInvestigationStore((s) => s.closeVerify);
  const [view, setView] = useState<"robot" | "source">("robot");
  const cameraDeviceId = view === "source" && sourceId ? sourceId : investigation.robotDeviceId;
  const { camera, stream, error } = useCameraSession(cameraDeviceId, true);

  return (
    <Modal label={title} onClose={closeVerify} variant="fullscreen">
      <ModalHeader title={title} onClose={closeVerify} />
      <div className={layout.body}>
        <div className={layout.stage}>
          {sourceId && (
            <div className={layout.switcher} role="tablist" aria-label="Camera">
              <SwitchButton on={view === "robot"} onClick={() => setView("robot")} name={investigation.robotDeviceId} role="Robot" />
              <SwitchButton on={view === "source"} onClick={() => setView("source")} name={sourceId} role="Source" />
            </div>
          )}
          <div className={layout.feed}>
            {error ? <Note tone="danger">{error}</Note> : <CameraStreamView camera={camera} stream={stream} />}
          </div>
        </div>

        <aside className={layout.sidebar}>
          <section className={layout.section}>
            <h3 className={layout.sectionTitle}>{section}</h3>
            <InfoList gap={8}>{children}</InfoList>
          </section>
          <section className={cx(layout.section, layout.footer)}>
            <Note size="sm">{note}</Note>
          </section>
        </aside>
      </div>
    </Modal>
  );
}

/** On site at a tower whose camera is unhealthy: the robot's view, or the tower's. */
function CameraCheckDialog({ investigation, anomalyId }: { investigation: Investigation; anomalyId: string }) {
  const anomaly = useDeviceStore((s) => s.anomalies[anomalyId]);
  const now = useNow();
  const sourceId = anomaly?.sourceDeviceId ?? null;
  return (
    <ObserveDialog
      investigation={investigation}
      title={`Camera check ${sourceId ?? anomalyId}`}
      sourceId={sourceId}
      section="Anomaly"
      note="Nothing to verify. The anomaly clears once the tower's camera recovers."
    >
      {anomaly && (
        <>
          <InfoRow label="Type" value={formatAnomalyTypes(anomaly.types)} />
          <ReasonRow deviceId={anomaly.sourceDeviceId} />
          <InfoRow label="Detected" value={`${formatAge(anomaly.detectedAt, now)} ago`} />
          <InfoRow label="Source" value={anomaly.sourceDeviceId} />
        </>
      )}
    </ObserveDialog>
  );
}

/** On site at an explored point: the robot's cameras. */
function ExploreDialog({ investigation }: { investigation: Investigation }) {
  const now = useNow();
  const { x, y } = investigation.lookAt;
  return (
    <ObserveDialog
      investigation={investigation}
      title="Explore"
      sourceId={null}
      section="Explore"
      note="Nothing to verify. Have a look, then send the robot back from the card."
    >
      <InfoRow label="Position" value={`${x.toFixed(1)}, ${y.toFixed(1)}`} />
      {investigation.arrivedAt && <InfoRow label="Arrived" value={`${formatAge(investigation.arrivedAt, now)} ago`} />}
    </ObserveDialog>
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
