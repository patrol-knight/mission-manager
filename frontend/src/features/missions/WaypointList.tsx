import { useContext } from "react";
import { useMissionEditor } from "./useMissionEditor";
import { isHomeWaypoint } from "./missionEditorReducer";
import { MapContext } from "../map/MapContext";
import { xyToLngLat } from "../../api/mapApi";

export function WaypointList() {
  const { state, dispatch } = useMissionEditor();
  const { map } = useContext(MapContext);

  const handleSelect = async (id: string) => {
    dispatch({ type: "SELECT_WAYPOINT", id });
    const wp = state.waypoints.find((w) => w.waypointId === id);
    if (!wp || !map) return;
    try {
      const { lat, lon } = await xyToLngLat(wp.x, wp.y);
      map.flyTo({ center: [lon, lat], duration: 500 });
    } catch {
      // Map projection unavailable — selection still updates, just no camera move.
    }
  };

  return (
    <div>
      <h4 style={{ margin: "0 0 8px 0", fontSize: 13, fontWeight: 600, color: "#495057", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Waypoints
      </h4>
      {state.waypoints.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: "#6c757d" }}>Click the map to add a waypoint.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
          {state.waypoints.map((wp, index) => {
            const home = isHomeWaypoint(state.waypoints, wp.waypointId);
            const selected = state.selectedWaypointId === wp.waypointId;
            return (
              <li key={wp.waypointId}>
                <button
                  onClick={() => handleSelect(wp.waypointId)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 13,
                    background: selected ? "#e7f1ff" : "transparent",
                    color: "#212529",
                  }}
                >
                  <span>
                    #{index + 1} {home && <strong style={{ color: "#f08c00" }}>Home</strong>}
                  </span>
                  <span style={{ color: "#6c757d", fontFamily: "monospace" }}>
                    ({wp.x.toFixed(2)}, {wp.y.toFixed(2)})
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
