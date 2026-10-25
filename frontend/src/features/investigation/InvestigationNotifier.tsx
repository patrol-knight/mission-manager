import { useEffect, useRef } from "react";
import { getRealtimeClient } from "../../api/realtimeClient";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { describeAbort } from "./investigationTypes";

/**
 * Renderless. Announces the transitions the system makes on its own, so a
 * change never looks like it came from nowhere: arriving at the anomaly
 * (which also opens the verify window), and autonomy being aborted (e.g. the
 * robot was lost), which stops the mission and any investigation until the
 * operator starts again. Transitions the operator triggers are announced
 * where they're triggered.
 */
export function InvestigationNotifier() {
  const investigation = useInvestigationStore((s) => s.investigation);
  const openVerify = useInvestigationStore((s) => s.openVerify);
  const { show } = useToast();
  const previousRef = useRef(investigation);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = investigation;
    const arrived =
      investigation?.phase === "on_site" &&
      previous?.anomalyId === investigation.anomalyId &&
      previous.phase === "en_route";
    if (arrived) {
      show("warning", "Arrived at the anomaly. Please verify.");
      openVerify();
    }
  }, [investigation, openVerify, show]);

  useEffect(
    () =>
      getRealtimeClient().on("autonomy.aborted", (aborted) => {
        show(
          "error",
          `${describeAbort(aborted)}. Mission and investigation stopped.`,
          "Start the mission or investigate again when you're ready.",
        );
      }),
    [show],
  );

  return null;
}
