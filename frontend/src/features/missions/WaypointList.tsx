import { useContext, useState } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { MapContext } from "../map/MapContext";
import { xyToLngLat } from "../../api/mapApi";
import { Button } from "../../components/ui/Button";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { cx } from "../../components/ui/cx";
import { MAX_DWELL_SEC } from "./missionEditorReducer";
import { formatDwell } from "./missionSummaryFormat";
import styles from "./WaypointList.module.css";

const DWELL_STEP_SEC = 5;

/** The draft's waypoints in route order. Selecting a row selects the
 * waypoint (same as clicking its marker), centers the map on it and opens
 * its dwell setting. */
export function WaypointList() {
  const { state, dispatch } = useMissionEditor();
  const { map } = useContext(MapContext);

  const select = async (id: string) => {
    dispatch({ type: "SELECT_WAYPOINT", id });
    const wp = state.waypoints.find((w) => w.waypointId === id);
    if (!wp || !map) return;
    try {
      const { lat, lon } = wp.lat != null && wp.lon != null ? { lat: wp.lat, lon: wp.lon } : await xyToLngLat(wp.x, wp.y);
      map.easeTo({ center: [lon, lat], duration: 400 });
    } catch {
      // Map projection unavailable: selection still updates, no camera move.
    }
  };

  return (
    <div>
      <SectionLabel aside={<span className={styles.count}>{state.waypoints.length}</span>}>Waypoints</SectionLabel>
      {state.waypoints.length > 0 && (
        <ol className={styles.list}>
          {state.waypoints.map((wp, index) => {
            const selected = state.selectedWaypointId === wp.waypointId;
            return (
              <li key={wp.waypointId} className={cx(styles.item, selected && styles.selected)}>
                <div className={styles.line}>
                  <button type="button" className={styles.row} onClick={() => void select(wp.waypointId)} aria-pressed={selected}>
                    <span className={styles.number}>{index + 1}</span>
                    <span className={styles.coords}>
                      {wp.x.toFixed(2)}, {wp.y.toFixed(2)}
                    </span>
                    {wp.dwellSec > 0 && !selected && <span className={styles.dwell}>{formatDwell(wp.dwellSec)}</span>}
                  </button>
                  {selected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dispatch({ type: "DELETE_WAYPOINT", id: wp.waypointId })}
                      data-hint="Remove (Delete)"
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {selected && (
                  <DwellField
                    value={wp.dwellSec}
                    onChange={(dwellSec) => dispatch({ type: "SET_WAYPOINT_DWELL", id: wp.waypointId, dwellSec })}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** How long the robot holds at the selected waypoint: a stepper in the
 * Loops stepper's style. */
function DwellField({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  // Typed text is kept until it's committed, so the field can be cleared and retyped.
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // The value changed elsewhere (stepper, preset, undo): show it.
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const parsed = Number(text);
    if (text.trim() === "" || !Number.isFinite(parsed)) setText(String(value));
    else onChange(parsed);
  };

  return (
    <div className={styles.dwellField}>
      <span className={styles.dwellLabel}>Dwell</span>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.stepButton}
          aria-label="Shorter dwell"
          disabled={value <= 0}
          onClick={() => onChange(value - DWELL_STEP_SEC)}
        >
          −
        </button>
        <input
          className={styles.stepInput}
          aria-label="Dwell in seconds"
          type="number"
          min={0}
          max={MAX_DWELL_SEC}
          step={DWELL_STEP_SEC}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
        />
        <button
          type="button"
          className={styles.stepButton}
          aria-label="Longer dwell"
          disabled={value >= MAX_DWELL_SEC}
          onClick={() => onChange(value + DWELL_STEP_SEC)}
        >
          +
        </button>
      </div>
      <span className={styles.dwellLabel}>sec</span>
    </div>
  );
}
