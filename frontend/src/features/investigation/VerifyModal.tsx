import { useEffect, useRef, useState } from "react";
import { useDeviceStore } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { setVerdict } from "../../api/investigationApi";
import { useCameraSession } from "../devices/useCameraSession";
import { CameraStreamView } from "../cameras/CameraStreamView";
import {
  formatAnomalyTypes,
  formatConfidence,
  VERDICT_COLORS,
  VERDICT_LABELS,
  type AnomalyVerdict,
} from "../anomalies/anomalyTypes";
import type { Investigation } from "./investigationTypes";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeVerify();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus();
    };
  }, [closeVerify]);

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20000,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Verify anomaly"
        tabIndex={-1}
        style={{
          width: "90vw",
          height: "90vh",
          background: "#1a1b1e",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderBottom: "1px solid #343a40" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>Verify anomaly</span>
          {anomaly && (
            <span style={{ fontSize: 13, color: "#adb5bd" }}>
              {formatAnomalyTypes(anomaly.types)} · {formatConfidence(anomaly.confidence)}
            </span>
          )}
          <button
            onClick={closeVerify}
            aria-label="Close"
            style={{ marginLeft: "auto", border: "none", background: "none", color: "#adb5bd", fontSize: 22, cursor: "pointer" }}
          >
            ×
          </button>
        </div>
        <div style={{ flex: 1, padding: 16, minHeight: 0 }}>
          {error ? (
            <div style={{ color: "#ff8787", fontSize: 13 }}>{error}</div>
          ) : (
            <CameraStreamView camera={camera} stream={stream} />
          )}
        </div>
        <div style={{ padding: 16, borderTop: "1px solid #343a40", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "#adb5bd", marginRight: "auto" }}>
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
                  borderRadius: 8,
                  border: `2px solid ${VERDICT_COLORS[verdict]}`,
                  background: selected ? VERDICT_COLORS[verdict] : "transparent",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: pending !== null ? "wait" : "pointer",
                }}
              >
                {pending === verdict ? "Saving…" : VERDICT_LABELS[verdict]}
              </button>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes camera-tile-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
