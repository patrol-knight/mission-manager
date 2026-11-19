import { useState } from "react";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { cancelInvestigation } from "../../api/investigationApi";
import { fallbackAfterInvestigation } from "./fallback";

/** Ends Explore -- Cancel en route, Dismiss on site -- and hands the robot
 * back like an investigation: to the mission's route, or holding in place.
 * `label` names what Dismiss leads to. */
export function useEndExplore(): { end: () => Promise<void>; pending: boolean; label: string } {
  const execution = useMissionStore((s) => s.execution);
  const definition = useMissionStore((s) => s.definition);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  const fallback = fallbackAfterInvestigation(execution, definition);

  const end = async () => {
    setPending(true);
    try {
      await cancelInvestigation();
      setInvestigation(null);
      show("info", fallback.doneMessage);
    } catch (err) {
      show("error", "Couldn't end Explore", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };
  return { end, pending, label: fallback.kind === "route" ? "Back to route" : "Done" };
}
