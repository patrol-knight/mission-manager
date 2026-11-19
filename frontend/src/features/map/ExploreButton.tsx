import { useInvestigationStore } from "../../stores/investigationStore";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { robotUnavailableHint } from "../devices/robotStatus";
import styles from "./ExploreButton.module.css";

/** Explore, among the map's controls: picks a point on the map for the robot
 * to go and look at. While picking it says so, and cancels. */
export function ExploreButton() {
  const robot = useConnectedRobot();
  const picking = useInvestigationStore((s) => s.picking);
  const startPicking = useInvestigationStore((s) => s.startPicking);
  const stopPicking = useInvestigationStore((s) => s.stopPicking);
  const unavailable = robotUnavailableHint(robot);

  if (picking) {
    return (
      <div className={styles.picking} role="status">
        <span className={styles.dot} />
        Click where to explore
        <button type="button" className={styles.cancel} onClick={stopPicking}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <span data-hint={unavailable ?? "Send the robot to look at a point"}>
      <button type="button" className={styles.button} disabled={unavailable !== null} onClick={startPicking}>
        Explore
      </button>
    </span>
  );
}
