import { useDeviceStore } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useApiConnection } from "../../hooks/useApiConnection";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { describeRobotActivity, type ActivityTone } from "./robotActivity";

const TONE_COLORS: Record<ActivityTone, string> = {
  investigating: "#f08c00",
  active: "#1c7ed6",
  idle: "#495057",
  offline: "#adb5bd",
};

/** The one status line the operator reads: what the robot is doing and what
 * happens next (docs/investigate-mode-design.md §8.1). */
export function RobotActivityStatus() {
  const { status } = useApiConnection();
  const robot = useConnectedRobot();
  const investigation = useInvestigationStore((s) => s.investigation);
  const target = useDeviceStore((s) => (investigation ? (s.anomalies[investigation.anomalyId] ?? null) : null));
  const execution = useMissionStore((s) => s.execution);
  const definition = useMissionStore((s) => s.definition);

  const distanceM =
    robot && investigation
      ? Math.hypot(robot.pose.x - investigation.target.x, robot.pose.y - investigation.target.y)
      : null;
  const activity =
    status !== "connected"
      ? { title: "Connecting to backend…", detail: null, next: null, tone: "offline" as const }
      : describeRobotActivity({ robotConnected: robot !== null, investigation, target, distanceM, execution, definition });
  const color = TONE_COLORS[activity.tone];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 14px",
        borderRadius: 10,
        background: "#fff",
        borderLeft: `4px solid ${color}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 700, color }}>{activity.title}</span>
      {activity.detail && <span style={{ fontSize: 13, color: "#495057" }}>{activity.detail}</span>}
      {activity.next && <span style={{ fontSize: 12, color: "#868e96" }}>Next: {activity.next}</span>}
    </div>
  );
}
