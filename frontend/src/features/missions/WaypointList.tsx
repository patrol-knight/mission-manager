import { useContext } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { MapContext } from "../map/MapContext";
import { xyToLngLat } from "../../api/mapApi";
import { Button } from "../../components/ui/Button";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { cx } from "../../components/ui/cx";
import styles from "./WaypointList.module.css";

/** The draft's waypoints in route order. Selecting a row selects the
 * waypoint (same as clicking its marker) and centers the map on it. */
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
                <button type="button" className={styles.row} onClick={() => void select(wp.waypointId)} aria-pressed={selected}>
                  <span className={styles.number}>{index + 1}</span>
                  <span className={styles.coords}>
                    {wp.x.toFixed(2)}, {wp.y.toFixed(2)}
                  </span>
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
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
