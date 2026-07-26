import { useState, type CSSProperties, type ReactNode } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { parseLoopCount, isNameValid, canSave } from "./missionEditorReducer";
import { WaypointList } from "./WaypointList";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useToast } from "../../components/useToast";
import { useMissionStore } from "../../stores/missionStore";
import { validateRoute, saveMission } from "../../api/missionApi";
import { snapWaypoint } from "../../api/mapApi";

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: "#495057",
};

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  fontSize: 14,
};

const primaryButtonStyle: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "none",
  background: "#1c7ed6",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  background: "#fff",
  color: "#212529",
  cursor: "pointer",
};

function FieldError({ children }: { children: ReactNode }) {
  return <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#dc3545" }}>{children}</p>;
}

function disabledStyle(base: CSSProperties, enabled: boolean): CSSProperties {
  return { ...base, opacity: enabled ? 1 : 0.5, cursor: enabled ? "pointer" : "not-allowed" };
}

interface MissionEditorPanelProps {
  onCancel: () => void;
  onSaved: () => void;
}

export function MissionEditorPanel({ onCancel, onSaved }: MissionEditorPanelProps) {
  const { state, dispatch } = useMissionEditor();
  const setDefinition = useMissionStore((s) => s.setDefinition);
  const { show } = useToast();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const nameError = !isNameValid(state.name) ? "Mission name is required" : null;
  const loopCount = parseLoopCount(state.loopCountInput);
  const loopCountError = loopCount === null ? "Loop count must be a whole number, 1 or greater" : null;
  const waypointCountError = state.waypoints.length < 2 ? "At least two waypoints are required" : null;

  // Explicitly reset the shared editor context on cancel rather than leaving
  // the draft dangling until the next OPEN dispatch overwrites it -- that
  // "cleared implicitly next time" gap is exactly the kind of thing that
  // could look like "cancel didn't really discard" if anything ever reads
  // editor state before the next entry point dispatches OPEN.
  const discard = () => {
    dispatch({ type: "OPEN", mission: null });
    onCancel();
  };

  const handleCancelClick = () => {
    if (state.dirty) setShowDiscardConfirm(true);
    else discard();
  };

  const handleValidate = async () => {
    setValidating(true);
    try {
      // Snap each waypoint onto its nearest lanelet centerline first, so saved
      // waypoints line up cleanly on the road instead of sitting slightly off
      // to one side of it. A per-waypoint snap failure keeps that waypoint's
      // original click rather than aborting the whole validate action.
      const snapped = await Promise.all(
        state.waypoints.map(async (wp) => {
          try {
            const point = await snapWaypoint(wp.x, wp.y);
            return { ...wp, x: point.x, y: point.y };
          } catch {
            return wp;
          }
        }),
      );
      dispatch({ type: "SNAP_WAYPOINTS", waypoints: snapped });

      const result = await validateRoute(snapped);
      dispatch({ type: "SET_VALIDATION_RESULT", result });
      if (result.valid) show("success", "Route valid", "The waypoints form a reachable route.");
      else show("warning", "Route invalid", result.errors[0]?.message);
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (loopCount === null) return;
    setSaving(true);
    try {
      const saved = await saveMission({
        missionId: state.missionId,
        name: state.name,
        loopCount,
        waypoints: state.waypoints,
      });
      setDefinition(saved);
      dispatch({ type: "MARK_SAVED" });
      show("success", "Mission saved", `${saved.name} is now the active mission.`);
      onSaved();
    } catch (err) {
      show("error", "Save failed", err instanceof Error ? err.message : "Could not save mission.");
    } finally {
      setSaving(false);
    }
  };

  const saveEnabled = canSave(state) && !saving;
  const validateEnabled = !validating && state.waypoints.length >= 2;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={cardStyle}>
        <label style={labelStyle}>
          Mission name
          <input
            value={state.name}
            onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
            style={inputStyle}
          />
        </label>
        {nameError && <FieldError>{nameError}</FieldError>}
      </div>

      <div style={cardStyle}>
        <label style={labelStyle}>
          Loop count
          <input
            type="number"
            min={1}
            step={1}
            value={state.loopCountInput}
            onChange={(e) => dispatch({ type: "SET_LOOP_COUNT_INPUT", value: e.target.value })}
            style={inputStyle}
          />
        </label>
        {loopCountError && <FieldError>{loopCountError}</FieldError>}
      </div>

      <div style={cardStyle}>
        <WaypointList />
        {waypointCountError && <FieldError>{waypointCountError}</FieldError>}
      </div>

      <div style={cardStyle}>
        {state.validationResult === null ? (
          <p style={{ margin: 0, fontSize: 12, color: "#6c757d" }}>Route not yet validated.</p>
        ) : state.validationStale ? (
          <p style={{ margin: 0, fontSize: 12, color: "#e8590c" }}>
            Waypoints changed since the last validation — validate again before saving.
          </p>
        ) : state.validationResult.valid ? (
          <p style={{ margin: 0, fontSize: 12, color: "#2f9e44" }}>Route is valid.</p>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: "#dc3545" }}>
            {state.validationResult.errors[0]?.message ?? "Route is invalid."}
          </p>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={handleCancelClick} style={secondaryButtonStyle}>
          Cancel
        </button>
        <button
          disabled={!validateEnabled}
          onClick={handleValidate}
          style={disabledStyle(secondaryButtonStyle, validateEnabled)}
        >
          {validating ? "Validating…" : "Validate Route"}
        </button>
        <button disabled={!saveEnabled} onClick={handleSave} style={disabledStyle(primaryButtonStyle, saveEnabled)}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {showDiscardConfirm && (
        <ConfirmDialog
          title="Discard unsaved mission changes?"
          confirmLabel="Discard"
          cancelLabel="Stay"
          onConfirm={() => {
            setShowDiscardConfirm(false);
            discard();
          }}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </div>
  );
}
