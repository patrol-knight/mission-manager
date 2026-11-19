import { useState } from "react";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { useToast } from "../../components/useToast";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { Pill } from "../../components/ui/Pill";
import { Note } from "../../components/ui/Note";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { explore } from "../../api/investigationApi";
import { useNow, formatAge } from "../../hooks/useNow";
import { formatDistance, formatDuration } from "../missions/missionSummaryFormat";
import { lineLengthM, remainingRoute } from "../map/geo";
import { useEndExplore } from "./explore";
import type { Investigation } from "./investigationTypes";

/** A point picked to explore, in the selected anomaly's slot -- like an
 * anomaly's card: how far the robot would drive and how long it would take,
 * then Investigate. Another click on the map moves the point. */
export function ExplorePickCard() {
  const picked = useInvestigationStore((s) => s.picked);
  const setInvestigation = useInvestigationStore((s) => s.setInvestigation);
  const stopPicking = useInvestigationStore((s) => s.stopPicking);
  const { show } = useToast();
  const [pending, setPending] = useState(false);
  if (!picked) return null;

  const preview = picked.preview;
  const send = async () => {
    setPending(true);
    try {
      setInvestigation(await explore(picked.lat, picked.lon));
      stopPicking();
    } catch (err) {
      show("error", "Couldn't send the robot", err instanceof Error ? err.message : undefined);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card enter title="Explore" aria-label="Point to explore">
      {picked.error ? (
        <Note tone="danger" size="sm">
          {picked.error}
        </Note>
      ) : (
        <InfoList gap={6}>
          <InfoRow label="Distance" value={preview ? formatDistance(preview.lengthM) : "…"} />
          <InfoRow label="ETA" value={preview ? formatDuration(preview.etaSec) : "…"} />
        </InfoList>
      )}
      <ButtonRow>
        <Button variant="primary" block onClick={() => void send()} disabled={!preview || pending}>
          {pending ? "Sending…" : "Investigate"}
        </Button>
        <Button block onClick={stopPicking}>
          Cancel
        </Button>
      </ButtonRow>
    </Card>
  );
}

/** Explore in progress, in the investigation card's slot, like the
 * Investigate card: what's left to drive, then how long it has been there.
 * A new point is picked from the map's Explore button, as a new anomaly from
 * the map. Keyed by start time, so a new point slides a fresh card in. */
export function ExploreCard() {
  const investigation = useInvestigationStore((s) => s.investigation);
  if (!investigation || investigation.kind !== "manual") return null;
  return <ExploreCardBody key={investigation.startedAt} investigation={investigation} />;
}

function ExploreCardBody({ investigation }: { investigation: Investigation }) {
  const openVerify = useInvestigationStore((s) => s.openVerify);
  const robotLon = useDeviceStore((s) => selectRobot(s)?.pose?.lon ?? null);
  const robotLat = useDeviceStore((s) => selectRobot(s)?.pose?.lat ?? null);
  const { end, pending, label } = useEndExplore();
  const now = useNow();
  const onSite = investigation.phase === "on_site";

  const coords = investigation.route.geometry.coordinates as [number, number][];
  const left = robotLon !== null && robotLat !== null ? remainingRoute(coords, [robotLon, robotLat]) : coords;
  const elapsed = (now - Date.parse(investigation.startedAt)) / 1000;
  const eta = investigation.etaSec === null ? null : Math.max(0, investigation.etaSec - elapsed);

  return (
    <Card
      enter
      title="Explore"
      aside={<Pill tone="investigate">{onSite ? "On site" : "En route"}</Pill>}
      aria-label="Explore"
    >
      <InfoList gap={6}>
        {onSite && investigation.arrivedAt ? (
          <InfoRow label="Arrived" value={`${formatAge(investigation.arrivedAt, now)} ago`} />
        ) : (
          <>
            <InfoRow label="Distance" value={formatDistance(lineLengthM(left))} />
            <InfoRow label="ETA" value={formatDuration(eta)} />
          </>
        )}
      </InfoList>
      <ButtonRow>
        {onSite ? (
          <>
            <Button variant="primary" block onClick={openVerify}>
              Observe
            </Button>
            <Button block onClick={() => void end()} disabled={pending}>
              {label}
            </Button>
          </>
        ) : (
          <Button variant="danger" block onClick={() => void end()} disabled={pending}>
            Cancel
          </Button>
        )}
      </ButtonRow>
    </Card>
  );
}
