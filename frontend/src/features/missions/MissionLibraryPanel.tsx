import { useEffect, useMemo, useRef, useState } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { useLibraryStore } from "../../stores/libraryStore";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { listMissionSummaries, getMission, deleteMission, activateMission } from "../../api/missionApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Button } from "../../components/ui/Button";
import { Collapse } from "../../components/ui/Collapse";
import { InfoList, InfoRow } from "../../components/ui/InfoRow";
import { Note } from "../../components/ui/Note";
import { Pill } from "../../components/ui/Pill";
import { useToast } from "../../components/useToast";
import { cx } from "../../components/ui/cx";
import { formatDistance, formatDuration, formatLoopTotal, estimateEtaSeconds } from "./missionSummaryFormat";
import type { MissionSummary } from "./missionTypes";
import styles from "./MissionLibraryPanel.module.css";

/** A search box appears once the list is long enough to need one. */
const SEARCH_FROM = 6;

interface MissionLibraryPanelProps {
  onBack: () => void;
  onEnterEditor: () => void;
}

/**
 * Every mission as one compact row, the active one first. Selecting a row
 * expands it (details + Activate / Edit / Delete) and previews its route on
 * the map (MissionPreviewLayer).
 */
export function MissionLibraryPanel({ onBack, onEnterEditor }: MissionLibraryPanelProps) {
  const { dispatch } = useMissionEditor();
  const selectedId = useLibraryStore((s) => s.selectedMissionId);
  const selectMission = useLibraryStore((s) => s.selectMission);
  const { show } = useToast();
  const { data: missions, error, loading, reload } = useAsyncResource(listMissionSummaries, []);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MissionSummary | null>(null);

  const sorted = useMemo(
    () =>
      [...(missions ?? [])].sort(
        (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.name.localeCompare(b.name),
      ),
    [missions],
  );
  const visible = sorted.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));

  // Open on the active mission when the list first loads, unless a row from
  // a previous visit is still selected. Only once: a row the operator
  // collapses must stay collapsed.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || sorted.length === 0) return;
    autoSelectedRef.current = true;
    if (!sorted.some((m) => m.missionId === selectedId)) selectMission(sorted[0].missionId);
  }, [sorted, selectedId, selectMission]);

  const handleNewMission = () => {
    dispatch({ type: "OPEN", mission: null });
    onEnterEditor();
  };

  const handleEdit = async (missionId: string) => {
    setBusyId(missionId);
    try {
      const mission = await getMission(missionId);
      dispatch({ type: "OPEN", mission });
      onEnterEditor();
    } catch (err) {
      show("error", "Failed to load mission", err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const runActivate = async (missionId: string, name: string) => {
    setBusyId(missionId);
    try {
      await activateMission(missionId);
      show("success", "Mission activated", name);
      reload();
    } catch (err) {
      show("error", "Failed to activate mission", err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (missionId: string) => {
    setBusyId(missionId);
    try {
      await deleteMission(missionId);
      show("success", "Mission deleted", undefined);
      if (selectedId === missionId) selectMission(null);
      reload();
    } catch (err) {
      show("error", "Delete failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <Button variant="primary" size="sm" onClick={handleNewMission}>
          New mission
        </Button>
      </div>

      {sorted.length >= SEARCH_FROM && (
        <input
          className={styles.search}
          type="search"
          placeholder="Search missions"
          aria-label="Search missions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {error && (
        <Note tone="danger" size="sm">
          Failed to load missions.
        </Note>
      )}
      {loading && !missions && <Note>Loading missions…</Note>}
      {missions?.length === 0 && <Note>No missions yet. Create one to get started.</Note>}

      {visible.length > 0 && (
        <ul className={styles.list}>
          {visible.map((m) => {
            const selected = m.missionId === selectedId;
            const busy = busyId === m.missionId;
            // An infinite mission has no end, so show the time for one loop instead.
            const eta = estimateEtaSeconds(m.distanceM, m.infiniteLoop ? 1 : m.loopCount);
            return (
              <li key={m.missionId} className={cx(styles.item, selected && styles.selected)}>
                <button
                  type="button"
                  className={styles.row}
                  aria-expanded={selected}
                  onClick={() => selectMission(selected ? null : m.missionId)}
                >
                  <span className={styles.rowText}>
                    <span className={styles.name}>{m.name}</span>
                    <span className={styles.meta}>
                      {m.waypointCount} waypoints · {formatDistance(m.distanceM)}
                    </span>
                  </span>
                  {m.isCurrent && (
                    <Pill tone="activate" dot>
                      Active
                    </Pill>
                  )}
                </button>
                <Collapse open={selected}>
                  <div className={styles.details}>
                    <InfoList>
                      <InfoRow dense label="Loops" value={formatLoopTotal(m)} />
                      <InfoRow dense label="Distance / loop" value={formatDistance(m.distanceM)} />
                      <InfoRow dense label={m.infiniteLoop ? "ETA / loop" : "ETA"} value={formatDuration(eta)} />
                    </InfoList>
                    <div className={styles.actions}>
                      <Button
                        variant="primary"
                        size="sm"
                        block
                        disabled={m.isCurrent || busy}
                        onClick={() => void runActivate(m.missionId, m.name)}
                        // Activating hands the mission over to be run.
                        className="mode-activate"
                      >
                        {m.isCurrent ? "Active" : "Activate"}
                      </Button>
                      <Button size="sm" block disabled={busy} onClick={() => void handleEdit(m.missionId)}>
                        Edit
                      </Button>
                      <Button variant="danger" size="sm" block disabled={busy} onClick={() => setDeleteTarget(m)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Collapse>
              </li>
            );
          })}
        </ul>
      )}
      {missions && missions.length > 0 && visible.length === 0 && <Note>No mission matches "{query}".</Note>}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete mission "${deleteTarget.name}"?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={() => void handleDelete(deleteTarget.missionId)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
