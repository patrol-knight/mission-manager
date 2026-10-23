import { useEffect, useState } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { parseLoopCount, isNameValid, canSave, type MissionEditorState } from "./missionEditorReducer";
import { WaypointList } from "./WaypointList";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { ButtonRow } from "../../components/ui/ButtonRow";
import { Note } from "../../components/ui/Note";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { useToast } from "../../components/useToast";
import { useMissionStore } from "../../stores/missionStore";
import { validateRoute, saveMission } from "../../api/missionApi";
import { formatDistance } from "./missionSummaryFormat";
import styles from "./MissionEditorPanel.module.css";

/** Wait this long after the last waypoint edit before checking the route,
 * so a burst of edits costs one request. */
const ROUTE_CHECK_DELAY_MS = 400;

interface MissionEditorPanelProps {
  onCancel: () => void;
  onSaved: () => void;
}

export function MissionEditorPanel({ onCancel, onSaved }: MissionEditorPanelProps) {
  const { state, dispatch } = useMissionEditor();
  const setDefinition = useMissionStore((s) => s.setDefinition);
  const { show } = useToast();
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);

  useAutoRouteCheck(state, dispatch);
  useEditorShortcuts(state, dispatch);

  const loopCount = parseLoopCount(state.loopCountInput);
  const nameError = nameTouched && !isNameValid(state.name) ? "Give the mission a name" : null;
  const loopCountError =
    !state.infiniteLoop && loopCount === null ? "Loops must be a whole number, 1 or more" : null;

  // Explicitly reset the shared editor context on cancel rather than leaving
  // the draft dangling until the next OPEN dispatch overwrites it.
  const discard = () => {
    dispatch({ type: "OPEN", mission: null });
    onCancel();
  };

  const handleCancelClick = () => {
    if (state.dirty) setShowDiscardConfirm(true);
    else discard();
  };

  const handleSave = async () => {
    if (!state.infiniteLoop && loopCount === null) return;
    setSaving(true);
    try {
      const saved = await saveMission({
        missionId: state.missionId,
        name: state.name,
        // Kept while infinite (its input is disabled), so a broken value then just falls back to 1.
        loopCount: loopCount ?? 1,
        infiniteLoop: state.infiniteLoop,
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

  const stepLoops = (delta: number) =>
    dispatch({ type: "SET_LOOP_COUNT_INPUT", value: String(Math.max(1, (loopCount ?? 1) + delta)) });

  return (
    <>
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          <SectionLabel>{state.missionId ? "Edit mission" : "New mission"}</SectionLabel>
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={state.history.length === 0}
          onClick={() => dispatch({ type: "UNDO" })}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={state.future.length === 0}
          onClick={() => dispatch({ type: "REDO" })}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </Button>
      </div>

      <div>
        <input
          className={styles.nameInput}
          aria-label="Mission name"
          placeholder="Mission name"
          value={state.name}
          onChange={(e) => dispatch({ type: "SET_NAME", name: e.target.value })}
          onBlur={() => setNameTouched(true)}
        />
        {nameError && <FieldError>{nameError}</FieldError>}
      </div>

      <Card>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>Loops</span>
          <div className={styles.loopControls}>
            <div className={styles.stepper}>
              <button
                type="button"
                className={styles.stepButton}
                aria-label="Fewer loops"
                disabled={state.infiniteLoop || (loopCount ?? 1) <= 1}
                onClick={() => stepLoops(-1)}
              >
                −
              </button>
              <input
                className={styles.stepInput}
                aria-label="Loop count"
                type="number"
                min={1}
                step={1}
                value={state.loopCountInput}
                disabled={state.infiniteLoop}
                onChange={(e) => dispatch({ type: "SET_LOOP_COUNT_INPUT", value: e.target.value })}
              />
              <button
                type="button"
                className={styles.stepButton}
                aria-label="More loops"
                disabled={state.infiniteLoop}
                onClick={() => stepLoops(1)}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={styles.toggle}
              aria-pressed={state.infiniteLoop}
              onClick={() => dispatch({ type: "SET_INFINITE_LOOP", value: !state.infiniteLoop })}
            >
              Infinite
            </button>
          </div>
        </div>
        {loopCountError && <FieldError>{loopCountError}</FieldError>}
      </Card>

      <Card>
        <WaypointList />
        <div style={{ marginTop: 12 }}>
          <RouteStatus state={state} />
        </div>
      </Card>

      <div className={styles.footer}>
        <ButtonRow marginTop={0}>
          <Button block onClick={handleCancelClick}>
            Cancel
          </Button>
          <Button variant="primary" block disabled={!canSave(state) || saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </ButtonRow>
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
    </>
  );
}

function FieldError({ children }: { children: string }) {
  return (
    <Note tone="danger" size="sm" className={styles.fieldError}>
      {children}
    </Note>
  );
}

/** One line on whether the waypoints make a drivable loop. */
function RouteStatus({ state }: { state: MissionEditorState }) {
  if (state.waypoints.length < 2) {
    return (
      <Note size="sm">
        {state.waypoints.length === 0 ? "Click the map to add waypoints." : "Add at least one more waypoint."}
      </Note>
    );
  }
  if (state.validationStale || !state.validationResult) {
    return <Note size="sm">Checking route…</Note>;
  }
  if (!state.validationResult.valid) {
    return (
      <Note tone="danger" size="sm">
        {state.validationResult.errors[0]?.message ?? "No drivable route through these waypoints."}
      </Note>
    );
  }
  const length = state.validationResult.route?.properties?.length_m;
  return (
    <Note tone="success" size="sm">
      Route OK{typeof length === "number" ? ` · ${formatDistance(length)} per loop` : ""}
    </Note>
  );
}

type Dispatch = ReturnType<typeof useMissionEditor>["dispatch"];

/** Checks the route a moment after each waypoint edit -- never mid-drag,
 * since a drag only becomes an edit on drop. Results for an older draft are
 * dropped by the reducer (revision). */
function useAutoRouteCheck(state: MissionEditorState, dispatch: Dispatch) {
  const { waypoints, revision, validationStale } = state;
  useEffect(() => {
    if (!validationStale || waypoints.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void validateRoute(waypoints).then((result) => {
        if (!cancelled) dispatch({ type: "SET_VALIDATION_RESULT", result, revision });
      });
    }, ROUTE_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waypoints, revision, validationStale, dispatch]);
}

/** Delete/Backspace removes the selected waypoint; Ctrl/Cmd+Z undoes,
 * Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Ignored while typing in a field. */
function useEditorShortcuts(state: MissionEditorState, dispatch: Dispatch) {
  const selected = state.selectedWaypointId;
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        dispatch({ type: "DELETE_WAYPOINT", id: selected });
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "REDO" : "UNDO" });
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, dispatch]);
}
