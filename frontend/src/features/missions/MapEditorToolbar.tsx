import type { CSSProperties } from "react";
import { useMissionEditor } from "./useMissionEditor";

const modeButtonStyle = (active: boolean): CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #dee2e6",
  background: active ? "#1c7ed6" : "#fff",
  color: active ? "#fff" : "#212529",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
});

const actionButtonStyle = (enabled: boolean): CSSProperties => ({
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #dee2e6",
  background: "#fff",
  color: "#212529",
  fontSize: 13,
  fontWeight: 500,
  opacity: enabled ? 1 : 0.5,
  cursor: enabled ? "pointer" : "not-allowed",
});

export function MapEditorToolbar() {
  const { state, dispatch } = useMissionEditor();

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 10,
        display: "flex",
        gap: 6,
        background: "#fff",
        padding: 6,
        borderRadius: 8,
        boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
      }}
    >
      <button
        aria-pressed={state.tool === "modify"}
        style={modeButtonStyle(state.tool === "modify")}
        onClick={() => dispatch({ type: "SET_TOOL", tool: "modify" })}
        title="Click empty lanelet space to add a waypoint, drag existing ones to move"
      >
        Modify
      </button>
      <button
        aria-pressed={state.tool === "delete"}
        style={modeButtonStyle(state.tool === "delete")}
        onClick={() => dispatch({ type: "SET_TOOL", tool: "delete" })}
        title="Click a waypoint to delete it"
      >
        Delete
      </button>
      <button
        disabled={state.history.length === 0}
        style={actionButtonStyle(state.history.length > 0)}
        onClick={() => dispatch({ type: "UNDO" })}
      >
        Undo
      </button>
      <button
        disabled={state.future.length === 0}
        style={actionButtonStyle(state.future.length > 0)}
        onClick={() => dispatch({ type: "REDO" })}
      >
        Redo
      </button>
    </div>
  );
}
