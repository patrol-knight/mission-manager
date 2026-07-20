import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { listMissionSummaries, getMission, deleteMission } from "../../api/missionApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useToast } from "../../components/useToast";

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const selectStyle: CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  fontSize: 14,
};

const iconButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #f5c6cb",
  background: "#fff",
  color: "#dc3545",
  cursor: "pointer",
  fontSize: 14,
};

const newButtonStyle: CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  background: "#fff",
  color: "#212529",
  cursor: "pointer",
  fontSize: 13,
  width: "100%",
};

/**
 * Lets the operator choose which mission to edit (or delete one) instead of
 * always silently editing the current mission. Owns all "what loads into the
 * draft" logic — MissionStatusPanel's Edit/New Mission button just switches to
 * the Editor view; this picker decides what appears there.
 */
export function MissionPicker() {
  const { state, dispatch } = useMissionEditor();
  const { show } = useToast();
  const { data: missions, error, reload } = useAsyncResource(listMissionSummaries, []);
  const [busy, setBusy] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [hasPendingSelection, setHasPendingSelection] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const autoSelectedRef = useRef(false);

  const loadMission = async (missionId: string) => {
    setBusy(true);
    try {
      const mission = await getMission(missionId);
      dispatch({ type: "OPEN", mission });
    } catch (err) {
      show("error", "Failed to load mission", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  // Auto-select once, the first time the list loads, but only if nothing has
  // already been loaded into the draft (e.g. this is a fresh entry into the
  // Editor, not a re-render after the user already picked something).
  useEffect(() => {
    if (!missions || autoSelectedRef.current) return;
    autoSelectedRef.current = true;
    if (state.missionId !== null) return;
    const preferred = missions.find((m) => m.isDefault) ?? missions.find((m) => m.isCurrent);
    if (preferred) loadMission(preferred.missionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missions]);

  const handleSelectChange = (missionId: string) => {
    if (state.dirty) {
      setPendingSelection(missionId);
      setHasPendingSelection(true);
      return;
    }
    loadMission(missionId);
  };

  const handleNewMission = () => {
    if (state.dirty) {
      setPendingSelection(null);
      setHasPendingSelection(true);
      return;
    }
    dispatch({ type: "OPEN", mission: null });
  };

  const confirmDiscardAndSwitch = () => {
    setHasPendingSelection(false);
    if (pendingSelection) loadMission(pendingSelection);
    else dispatch({ type: "OPEN", mission: null });
  };

  const handleDelete = async () => {
    if (!state.missionId) return;
    setBusy(true);
    try {
      await deleteMission(state.missionId);
      show("success", "Mission deleted", undefined);
      dispatch({ type: "OPEN", mission: null });
      reload();
    } catch (err) {
      show("error", "Delete failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div style={cardStyle}>
      <h4 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Mission
      </h4>

      {error && <p style={{ margin: "0 0 8px 0", fontSize: 12, color: "#dc3545" }}>Failed to load missions.</p>}

      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={state.missionId ?? ""}
          onChange={(e) => handleSelectChange(e.target.value)}
          disabled={busy || !missions}
          style={selectStyle}
        >
          <option value="" disabled>
            {missions ? "New / unsaved mission" : "Loading…"}
          </option>
          {missions?.map((m) => (
            <option key={m.missionId} value={m.missionId}>
              {m.name}
              {m.isDefault ? " (default)" : ""}
              {m.isCurrent ? " (active)" : ""}
            </option>
          ))}
        </select>
        <button
          disabled={!state.missionId || busy}
          onClick={() => setShowDeleteConfirm(true)}
          style={{ ...iconButtonStyle, opacity: state.missionId ? 1 : 0.5 }}
          title="Delete this mission"
          aria-label="Delete this mission"
        >
          🗑
        </button>
      </div>

      <button onClick={handleNewMission} disabled={busy} style={newButtonStyle}>
        + New Mission
      </button>

      {hasPendingSelection && (
        <ConfirmDialog
          title="Discard unsaved mission changes?"
          confirmLabel="Discard"
          cancelLabel="Stay"
          onConfirm={confirmDiscardAndSwitch}
          onCancel={() => setHasPendingSelection(false)}
        />
      )}

      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete mission "${state.name}"?`}
          message="This cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
