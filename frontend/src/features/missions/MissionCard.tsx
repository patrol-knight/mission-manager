import { useState } from "react";
import { useApiConnection } from "../../hooks/useApiConnection";
import { useMissionStore } from "../../stores/missionStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Pill } from "../../components/ui/Pill";
import { Note } from "../../components/ui/Note";
import { Collapse } from "../../components/ui/Collapse";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { startMission, pauseMission, resumeMission, cancelMission } from "../../api/missionApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { ProgressTrack } from "./ProgressTrack";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { missionProgress, missionStatus } from "./missionStatus";
import type { MissionDefinition, MissionExecutionState } from "./missionTypes";

/** Both rows in the mission's orange family, told apart by shade: the
 * route orange for waypoints, a deeper burnt orange for loops. */
const PROGRESS_COLORS = { waypoints: "#ff8a1f", loops: "#d9480f" };

interface MissionCardProps {
  /** Opens the mission list (pick, edit, add or delete missions). */
  onEdit: () => void;
  /** Opens the editor on a blank mission. */
  onCreate: () => void;
}

/** The current mission: name, status, progress and its controls. While the
 * robot investigates, the mission is frozen and the card folds into a
 * one-line "suspended" strip, unfolding again when the investigation ends. */
export function MissionCard({ onEdit, onCreate }: MissionCardProps) {
  const { status } = useApiConnection();
  const definition = useMissionStore((s) => s.definition);
  const execution = useMissionStore((s) => s.execution);
  const investigating = useInvestigationStore((s) => s.investigation !== null);

  if (status !== "connected") {
    return (
      <Card title="Mission">
        <Note>Connecting to backend…</Note>
      </Card>
    );
  }

  if (definition === null) {
    // Folded like a suspended mission while investigating, so the
    // investigation and anomaly cards still fit above the fleet.
    if (investigating) return <Card compact title="No mission" />;
    return (
      <Card title="No mission">
        <Note>Choose a saved mission or create a new one.</Note>
        <div className="mode-edit">
          <ButtonRow>
            <Button block onClick={onEdit}>
              Choose mission
            </Button>
            <Button variant="primary" block onClick={onCreate}>
              Create mission
            </Button>
          </ButtonRow>
        </div>
      </Card>
    );
  }

  const full = missionStatus(execution, false);
  const suspended = missionStatus(execution, true);

  return (
    <div>
      <Collapse open={!investigating}>
        <Card title={definition.name} aside={<Pill tone={full.tone} dot={full.live}>{full.label}</Pill>}>
          <MissionProgress definition={definition} execution={execution} />
          <MissionActions execution={execution} onEdit={onEdit} />
        </Card>
      </Collapse>
      <Collapse open={investigating}>
        <Card
          compact
          title={definition.name}
          aside={<Pill tone={suspended.tone}>{suspended.label}</Pill>}
          aria-label="Mission suspended while the robot investigates"
        />
      </Collapse>
    </div>
  );
}

function MissionProgress({
  definition,
  execution,
}: {
  definition: MissionDefinition;
  execution: MissionExecutionState | null;
}) {
  const { waypoints, loops } = missionProgress(definition.waypoints.length, definition, execution);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ProgressTrack {...waypoints} color={PROGRESS_COLORS.waypoints} />
      <ProgressTrack {...loops} color={PROGRESS_COLORS.loops} />
    </div>
  );
}

/** Start + Edit when idle; Pause/Resume + Cancel while it runs. */
function MissionActions({ execution, onEdit }: { execution: MissionExecutionState | null; onEdit: () => void }) {
  const setExecution = useMissionStore((s) => s.setExecution);
  const robot = useConnectedRobot();
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const run = async (action: () => Promise<MissionExecutionState>, label: string) => {
    setPending(true);
    try {
      const result = await action();
      setExecution(result);
      return result;
    } catch (err) {
      show("error", `${label} failed`, err instanceof Error ? err.message : undefined);
      return null;
    } finally {
      setPending(false);
    }
  };

  const start = async () => {
    const result = await run(startMission, "Start");
    if (result?.targetWaypointIndex != null) show("info", `Starting from waypoint ${result.targetWaypointIndex + 1}`);
  };

  const cancel = async () => {
    setConfirmCancel(false);
    if (await run(cancelMission, "Cancel")) show("info", "Mission cancelled", "The robot is holding its position");
  };

  const cancelButton = (
    <Button variant="danger" block disabled={pending} onClick={() => setConfirmCancel(true)}>
      Cancel
    </Button>
  );
  const cancelDialog = confirmCancel && (
    <ConfirmDialog
      title="Cancel the mission?"
      message="The robot stops where it is and this run's progress is lost."
      confirmLabel="Cancel mission"
      cancelLabel="Keep going"
      onConfirm={() => void cancel()}
      onCancel={() => setConfirmCancel(false)}
    />
  );

  switch (execution?.status) {
    case "running":
      return (
        <ButtonRow>
          <Button block disabled={pending} onClick={() => run(pauseMission, "Pause")}>
            Pause
          </Button>
          {cancelButton}
          {cancelDialog}
        </ButtonRow>
      );
    case "paused":
      return (
        <ButtonRow>
          <Button variant="primary" block disabled={pending} onClick={() => run(resumeMission, "Resume")}>
            Resume
          </Button>
          {cancelButton}
          {cancelDialog}
        </ButtonRow>
      );
    default: {
      // "completed" is only broadcast for a moment before the backend resets to idle.
      const ready = execution?.status === "ready" && robot !== null;
      return (
        <ButtonRow>
          <span style={{ display: "flex", flex: 1 }} data-hint={ready ? undefined : "The robot is offline"}>
            <Button variant="primary" block disabled={pending || !ready} onClick={() => void start()}>
              Start
            </Button>
          </span>
          <Button block onClick={onEdit}>
            Edit
          </Button>
        </ButtonRow>
      );
    }
  }
}
