import { useEffect, useRef } from "react";
import { useToast } from "../../components/useToast";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useConnectedRobot } from "./useConnectedRobot";
import { FAILURE_HINT, robotState } from "./robotStatus";

/** Renderless. Toasts when the robot enters failure while no mission or
 * investigation is active; those announce it with their own pause or abort. */
export function RobotStateNotifier() {
  const state = robotState(useConnectedRobot());
  const running = useMissionStore((s) => s.execution?.status === "running" || s.execution?.status === "paused");
  const investigating = useInvestigationStore((s) => s.investigation !== null);
  const { show } = useToast();
  const previousRef = useRef(state);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = state;
    if (state === "failure" && previous !== "failure" && !running && !investigating) {
      show("error", "The robot reported a failure", `${FAILURE_HINT} until it's ready.`);
    }
  }, [state, running, investigating, show]);

  return null;
}
