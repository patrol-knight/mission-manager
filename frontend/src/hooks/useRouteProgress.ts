import { useEffect } from "react";
import { useWaypointStore } from "../stores/waypointStore";
import { useRobotPose } from "./useRobotPose";
import { useToast } from "../components/Toast";

const GOAL_RADIUS = 0.5; // m

export function useRouteProgress() {
  const routeProgress = useWaypointStore((s) => s.routeProgress);
  const advanceGoal   = useWaypointStore((s) => s.advanceGoal);
  const robotPose     = useRobotPose();
  const { show }      = useToast();

  useEffect(() => {
    if (!routeProgress?.active || !robotPose) return;

    let idx = routeProgress.currentGoalIdx;
    while (idx < routeProgress.goals.length) {
      const dx = routeProgress.goals[idx].x - robotPose.x;
      const dy = routeProgress.goals[idx].y - robotPose.y;
      if (Math.sqrt(dx ** 2 + dy ** 2) < GOAL_RADIUS) idx++; else break;
    }

    if (idx !== routeProgress.currentGoalIdx) {
      advanceGoal(idx, robotPose.speed ?? 0);
      const isLast = idx >= routeProgress.goals.length;
      if (isLast) {
        show("success", "Arrived", "Robot reached the final destination");
      } else {
        show("success", `Arrived`, `Route progress ${idx}/${routeProgress.goals.length}`);
      }
    }
  }, [robotPose]);
}
