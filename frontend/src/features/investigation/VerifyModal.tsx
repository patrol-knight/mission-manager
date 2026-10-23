import { useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { setVerdict } from "../../api/investigationApi";
import { useCameraSession } from "../devices/useCameraSession";
import { CameraStreamView } from "../cameras/CameraStreamView";
import { Modal, ModalHeader } from "../../components/ui/Modal";
import { Note } from "../../components/ui/Note";
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
  unclear: "Can't tell from here",
};

/** The robot's live camera plus the TRUE / FALSE / UNCLEAR choice. Each pick
 * is saved immediately as a draft; nothing is final until Finish. The window
 * can be closed and reopened (Verify button) any time while on site. */
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
  const { camera, stream, error } = useCameraSession(investigation.robotDeviceId, true);
  const { show } = useToast();
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
      <ModalHeader title="Verify anomaly" onClose={closeVerify}>
        {anomaly && (
          <span style={{ fontSize: "var(--text-md)", color: "var(--color-text-faint)" }}>
            {formatAnomalyTypes(anomaly.types)} · {formatConfidence(anomaly.confidence)}
          </span>
        )}
      </ModalHeader>
      <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
        {error ? <Note tone="danger">{error}</Note> : <CameraStreamView camera={camera} stream={stream} />}
      </div>
      <div
        style={{
          padding: 16,
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: "var(--text-md)", color: "var(--color-text-faint)", marginRight: "auto" }}>
          Saved as a draft. It's recorded when you press Finish.
        </span>
        {VERDICTS.map((verdict) => {
          const selected = investigation.draftVerdict === verdict;
          return (
            <button
              key={verdict}
              onClick={() => void choose(verdict)}
              disabled={pending !== null}
              aria-pressed={selected}
              title={VERDICT_HINTS[verdict]}
              style={{
                minWidth: 110,
                padding: "10px 20px",
                borderRadius: "var(--radius-md)",
                border: `2px solid ${VERDICT_COLORS[verdict]}`,
                background: selected ? VERDICT_COLORS[verdict] : "transparent",
                color: "var(--color-text-on-accent)",
                fontWeight: 700,
                fontSize: "var(--text-base)",
                cursor: pending !== null ? "wait" : "pointer",
              }}
            >
              {pending === verdict ? "Saving…" : VERDICT_LABELS[verdict]}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
