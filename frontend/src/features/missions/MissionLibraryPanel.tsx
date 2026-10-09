import { useState, type CSSProperties, type ReactNode } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { useMissionStore } from "../../stores/missionStore";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { listMissionSummaries, getMission, deleteMission, activateMission } from "../../api/missionApi";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useToast } from "../../components/useToast";
import { formatDistance, formatDuration, formatLoopTotal, estimateEtaSeconds } from "./missionSummaryFormat";
import type { MissionSummary } from "./missionTypes";

const cardStyle: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const headerButtonStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  background: "#fff",
  color: "#212529",
  cursor: "pointer",
  fontSize: 13,
};

const newButtonStyle: CSSProperties = {
  ...headerButtonStyle,
  border: "none",
  background: "#1c7ed6",
  color: "#fff",
  fontWeight: 600,
};

const rowActionStyle: CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  borderRadius: 8,
  border: "1px solid #dee2e6",
  background: "#fff",
  color: "#212529",
  cursor: "pointer",
  fontSize: 12,
};

const dangerActionStyle: CSSProperties = {
  ...rowActionStyle,
  border: "1px solid #f5c6cb",
  color: "#dc3545",
};

function disabledStyle(base: CSSProperties, enabled: boolean): CSSProperties {
  return { ...base, opacity: enabled ? 1 : 0.5, cursor: enabled ? "pointer" : "not-allowed" };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ color: "#6c757d" }}>{label}</span>
      <span style={{ color: "#212529", fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#fff",
        background: color,
        borderRadius: 999,
        padding: "2px 8px",
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

interface MissionLibraryPanelProps {
  onBack: () => void;
  onEnterEditor: () => void;
}

/**
 * Mission-level browse view — shown before the waypoint canvas. Lets the
 * operator see every mission's summary (waypoints, home, distance, ETA),
 * set which one is current, delete one, or drill into "Edit"/"+ New Mission"
 * to open the canvas. Supersedes the old MissionPicker dropdown.
 */
export function MissionLibraryPanel({ onBack, onEnterEditor }: MissionLibraryPanelProps) {
  const { dispatch } = useMissionEditor();
  const execution = useMissionStore((s) => s.execution);
  const { show } = useToast();
  const { data: missions, error, loading, reload } = useAsyncResource(listMissionSummaries, []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MissionSummary | null>(null);
  const [activateTarget, setActivateTarget] = useState<MissionSummary | null>(null);

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
      show("success", "Mission set as current", name);
      reload();
    } catch (err) {
      show("error", "Failed to set current mission", err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
      setActivateTarget(null);
    }
  };

  const handleSetCurrent = (mission: MissionSummary) => {
    const runningElsewhere =
      execution !== null &&
      execution.missionId !== mission.missionId &&
      (execution.status === "running" || execution.status === "paused" || execution.status === "returning");
    if (runningElsewhere) {
      setActivateTarget(mission);
      return;
    }
    void runActivate(mission.missionId, mission.name);
  };

  const handleDelete = async (missionId: string) => {
    setBusyId(missionId);
    try {
      await deleteMission(missionId);
      show("success", "Mission deleted", undefined);
      reload();
    } catch (err) {
      show("error", "Delete failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
      setDeleteTarget(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={onBack} style={headerButtonStyle}>
          ← Back
        </button>
        <button onClick={handleNewMission} style={newButtonStyle}>
          + New Mission
        </button>
      </div>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#dc3545" }}>Failed to load missions.</p>}
      {loading && !missions && <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Loading missions…</p>}
      {missions?.length === 0 && (
        <div style={cardStyle}>
          <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>No missions yet — create one to get started.</p>
        </div>
      )}

      {missions?.map((m) => {
        // An infinite mission has no end, so show the time for one loop instead.
        const eta = estimateEtaSeconds(m.distanceM, m.infiniteLoop ? 1 : m.loopCount);
        const pinned = m.isCurrent;
        const busy = busyId === m.missionId;
        return (
          <div
            key={m.missionId}
            style={{
              ...cardStyle,
              border: pinned ? "2px solid #1c7ed6" : "2px solid transparent",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: "#212529" }}>{m.name}</div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {m.isCurrent && <Badge color="#1c7ed6">Active</Badge>}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "8px 0" }}>
              <Row label="Waypoints" value={`${m.waypointCount} · Loop count ${formatLoopTotal(m)}`} />
              <Row
                label="Home"
                value={m.homeX !== null && m.homeY !== null ? `(${m.homeX.toFixed(2)}, ${m.homeY.toFixed(2)})` : "—"}
              />
              <Row label="Distance / loop" value={formatDistance(m.distanceM)} />
              <Row label={m.infiniteLoop ? "ETA / loop" : "ETA"} value={formatDuration(eta)} />
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              <button
                disabled={m.isCurrent || busy}
                onClick={() => handleSetCurrent(m)}
                style={disabledStyle(rowActionStyle, !m.isCurrent && !busy)}
              >
                Set Current
              </button>
              <button
                disabled={busy}
                onClick={() => void handleEdit(m.missionId)}
                style={disabledStyle(rowActionStyle, !busy)}
              >
                Edit
              </button>
              <button
                disabled={busy}
                onClick={() => setDeleteTarget(m)}
                style={disabledStyle(dangerActionStyle, !busy)}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}

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

      {activateTarget && (
        <ConfirmDialog
          title="Robot is currently executing another mission"
          message={`Setting "${activateTarget.name}" as current will stop tracking that in-progress run.`}
          confirmLabel="Switch anyway"
          cancelLabel="Cancel"
          onConfirm={() => void runActivate(activateTarget.missionId, activateTarget.name)}
          onCancel={() => setActivateTarget(null)}
        />
      )}
    </div>
  );
}
