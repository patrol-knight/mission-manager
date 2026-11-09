import { useCallback, useEffect, useReducer, useState } from "react";
import { useToast } from "../../components/useToast";
import { geofenceApi } from "./geofenceApi";
import {
  canSubmit,
  geofenceEditorReducer,
  INITIAL_STATE,
  toWireZones,
  type GeofenceEditorAction,
  type GeofenceEditorState,
} from "./geofenceEditorReducer";

export interface GeofenceEditor {
  state: GeofenceEditorState;
  dispatch: (action: GeofenceEditorAction) => void;
  submit: () => void;
  submitting: boolean;
  error: string | null;
}

const message = (err: unknown) => (err instanceof Error ? err.message : "Request failed");

/** The saved zones and their edit session, shared by the card and the map layer. */
export function useGeofenceEditor(): GeofenceEditor {
  const [state, dispatch] = useReducer(geofenceEditorReducer, INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

  useEffect(() => {
    let cancelled = false;
    geofenceApi
      .get()
      .then(({ zones }) => {
        if (!cancelled) dispatch({ type: "LOADED", zones });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(message(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const editing = state.draft !== null;
  const hasSelectedPoint = state.selectedPointId !== null;
  useEffect(() => {
    if (!editing || !hasSelectedPoint) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "DELETE_POINT" });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [editing, hasSelectedPoint]);

  const submit = useCallback(() => {
    if (!canSubmit(state) || !state.draft) return;
    setSubmitting(true);
    setError(null);
    geofenceApi
      .replace(toWireZones(state.draft))
      .then(({ zones }) => {
        dispatch({ type: "LOADED", zones });
        show("success", "Geofences saved", "Anomaly detection gets them the next time it asks");
      })
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setSubmitting(false));
  }, [state, show]);

  return { state, dispatch, submit, submitting, error };
}
