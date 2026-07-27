import { useEffect, useRef } from "react";
import { useMissionStore } from "../../stores/missionStore";
import { useToast } from "../../components/useToast";

/**
 * Renderless — watches mission execution status for a transition into
 * "completed" and shows a one-time toast with the final loop count. The
 * backend only reports "completed" for a moment before resetting straight
 * to "ready" (see backend/core/mission_execution.py::_finish_mission) — a
 * finished mission is exactly as startable as a new one, so this is purely
 * a heads-up, not gating anything.
 */
export function MissionCompleteWatcher() {
  const execution = useMissionStore((s) => s.execution);
  const definition = useMissionStore((s) => s.definition);
  const { show } = useToast();
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = execution?.status ?? null;

    if (execution && execution.status === "completed" && prev !== "completed") {
      const loops = definition ? `${execution.completedLoops} / ${definition.loopCount}` : String(execution.completedLoops);
      show("success", "Mission Complete!", `${loops} loops completed`);
    }
  }, [execution, definition, show]);

  return null;
}
