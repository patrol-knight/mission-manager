import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { Card } from "../../components/ui/Card";
import { Pill } from "../../components/ui/Pill";
import { useConnectedRobot } from "./useConnectedRobot";
import { useDeviceInspector } from "./useDeviceInspector";
import { robotStatus } from "./robotStatus";

/** The robot: what it's doing, its name, then the two live readings an
 * operator acts on -- battery (when to stop) and speed (moving, stuck, or
 * parked). Its position and heading are already on the map. The whole card
 * opens the inspector (live camera + full telemetry). */
export function RobotCard() {
  const robot = useDeviceStore(selectRobot);
  const connected = useConnectedRobot() !== null;
  const investigation = useInvestigationStore((s) => s.investigation);
  const execution = useMissionStore((s) => s.execution);
  const { openInspector } = useDeviceInspector();

  if (!robot) {
    return (
      <Card title="Robot" aside={<Pill tone="muted">Not seen</Pill>}>
        <div style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>No robot has reported in yet</div>
      </Card>
    );
  }

  const status = robotStatus(connected, investigation, execution);
  const name = robot.name ?? robot.deviceId;
  return (
    <Card
      title="Robot"
      aside={
        <Pill tone={status.tone} dot={status.live}>
          {status.label}
        </Pill>
      }
      onClick={() => openInspector(robot.deviceId)}
      aria-label={`${name}: ${status.label}. Open camera and status`}
    >
      <div style={{ marginTop: -6, fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>{name}</div>
      <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
        <Reading label="Battery" value={robot.battery !== null ? `${Math.round(robot.battery)}%` : "—"} />
        <Reading label="Speed" value={robot.speed !== null ? `${robot.speed.toFixed(1)} m/s` : "—"} />
      </div>
    </Card>
  );
}

/** A small uppercase label over its value. */
function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: "var(--text-2xs)", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-faint)" }}>
        {label}
      </span>
      <span style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </div>
  );
}
