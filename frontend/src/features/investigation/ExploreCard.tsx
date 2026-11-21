import { useState } from "react";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { startExplore } from "../../api/investigationApi";
import { useConnectedRobot } from "../devices/useConnectedRobot";
import { needsVerdict, type InvestigationTarget } from "./investigationTypes";

/** Where the explored point is and how far: shared by the pick card and
 * the card in progress. */
export function ExploreInfoRows({ distance, lookAt }: { distance: string; lookAt: InvestigationTarget | null }) {
  return (
    <InfoList gap={6}>
      <InfoRow label="Position" value={lookAt ? `${lookAt.x.toFixed(1)}, ${lookAt.y.toFixed(1)}` : "…"} />
      <InfoRow label="Distance" value={distance} />
    </InfoList>
  );
}

/** The point picked to Explore, before the robot is sent: Investigate sends
 * it, Cancel drops the point. Shares the panel's slot with the selected
 * anomaly. */
export function ExploreCard() {
  const picked = useInvestigationStore((s) => s.picked);
  const stopPicking = useInvestigationStore((s) => s.stopPicking);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const blocked = useInvestigationStore((s) => needsVerdict(s.investigation));
  const robot = useConnectedRobot();
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  if (!picked) return null;

  const { preview, error } = picked;
  const disabledReason = !robot
    ? "The robot is offline"
    : blocked
      ? "Verify the current anomaly first"
      : error
        ? error
        : !preview
          ? "Finding where to stop…"
          : null;

  const investigate = async () => {
    setPending(true);
    try {
      setInvestigation(await startExplore(picked.lat, picked.lon));
    } catch (err) {
      show("error", "Couldn't start Explore", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card key={`${picked.lat},${picked.lon}`} enter title="Explore" aria-label="Explore point">
      <ExploreInfoRows
        distance={error ? "Can't reach" : preview ? `${Math.round(preview.lengthM)} m` : "…"}
        lookAt={preview?.lookAt ?? null}
      />
      <ButtonRow>
        <span style={{ display: "flex" }} data-hint={disabledReason ?? undefined}>
          <Button variant="primary" block onClick={() => void investigate()} disabled={pending || disabledReason !== null}>
            {pending ? "Sending…" : "Investigate"}
          </Button>
        </span>
        <Button block onClick={stopPicking}>
          Cancel
        </Button>
      </ButtonRow>
    </Card>
  );
}
