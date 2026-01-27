import * as React from "react";
import { createRoot } from "react-dom/client";
import { PanelExtensionContext } from "@foxglove/extension";

type Mode = "OFF" | "MODIFY" | "DELETE";

type Waypoint = {
  id: string;
  x: number;
  y: number;
  yaw: number;
};

export function initMissionPanel(ctx: PanelExtensionContext) {
  const root = createRoot(ctx.panelElement);

  ctx.advertise?.(
    "/mission/waypoints",
    "geometry_msgs/msg/PoseArray"
  );

  ctx.advertise?.(
    "/mission/markers",
    "visualization_msgs/msg/MarkerArray"
  );

  function Panel() {
    const [mode, setMode] = React.useState<Mode>("OFF");
    const [waypoints, setWaypoints] = React.useState<Waypoint[]>([]);

    function publishMarkers(wps: Waypoint[]) {
      const markers = wps.map((wp, i) => ({
        header: {
          frame_id: "map",
          stamp: {
            sec: Math.floor(Date.now() / 1000),
            nanosec: (Date.now() % 1000) * 1e6,
          },
        },
        ns: "waypoints",
        id: i,
        type: 2, 
        action: 0, 
        pose: {
          position: { x: wp.x, y: wp.y, z: 0.15 },
          orientation: {
            x: 0,
            y: 0,
            z: Math.sin(wp.yaw / 2),
            w: Math.cos(wp.yaw / 2),
          },
        },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
        color: { r: 0, g: 1, b: 0, a: 0.8 },
        lifetime: { sec: 0, nanosec: 0 },
      }));

      const textMarkers = wps.map((wp, i) => ({
        header: {
          frame_id: "map",
          stamp: {
            sec: Math.floor(Date.now() / 1000),
            nanosec: (Date.now() % 1000) * 1e6,
          },
        },
        ns: "waypoint_labels",
        id: i,
        type: 9, 
        action: 0,
        pose: {
          position: { x: wp.x, y: wp.y, z: 0.5 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 0.3, y: 0.3, z: 0.3 },
        color: { r: 1, g: 1, b: 1, a: 1 },
        text: `WP${i + 1}`,
        lifetime: { sec: 0, nanosec: 0 },
      }));

      // Clear old markers if empty
      if (wps.length === 0) {
        markers.push({
          header: {
            frame_id: "map",
            stamp: {
              sec: Math.floor(Date.now() / 1000),
              nanosec: (Date.now() % 1000) * 1e6,
            },
          },
          ns: "waypoints",
          id: 0,
          type: 2,
          action: 3, // DELETEALL
          pose: {
            position: { x: 0, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
          scale: { x: 0, y: 0, z: 0 },
          color: { r: 0, g: 0, b: 0, a: 0 },
          lifetime: { sec: 0, nanosec: 0 },
        });
        textMarkers.push({
          header: {
            frame_id: "map",
            stamp: {
              sec: Math.floor(Date.now() / 1000),
              nanosec: (Date.now() % 1000) * 1e6,
            },
          },
          ns: "waypoint_labels",
          id: 0,
          type: 9,
          action: 3, // DELETEALL
          pose: {
            position: { x: 0, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
          scale: { x: 0, y: 0, z: 0 },
          color: { r: 0, g: 0, b: 0, a: 0 },
          text: "",
          lifetime: { sec: 0, nanosec: 0 },
        });
      }

      const msg = {
        markers: [...markers, ...textMarkers],
      };

      ctx.publish?.("/mission/markers", msg);
    }

    React.useEffect(() => {
      publishMarkers(waypoints);
    }, [waypoints]);
    function findClosestWaypoint(
      x: number,
      y: number,
      threshold = 0.5
    ): Waypoint | null {
      let best: Waypoint | null = null;
      let bestDist = Infinity;

      for (const wp of waypoints) {
        const d = Math.hypot(wp.x - x, wp.y - y);
        if (d < bestDist && d < threshold) {
          best = wp;
          bestDist = d;
        }
      }

      return best;
    }
    React.useEffect(() => {
      ctx.subscribe?.(["/clicked_point"]);

      ctx.onRender = (renderState, done) => {
        if (renderState.currentFrame) {
          for (const msg of renderState.currentFrame) {
            if (msg.topic === "/clicked_point") {
              const pointMsg = msg.message as any;
              const pos = pointMsg?.point;

              if (!pos) continue;
              if (mode === "MODIFY") {
                const closest = findClosestWaypoint(pos.x, pos.y, 0.5);

                if (closest) {
                  // Move existing waypoint
                  setWaypoints((prev) => {
                    const updated = prev.map((wp) =>
                      wp.id === closest.id
                        ? { ...wp, x: pos.x, y: pos.y }
                        : wp
                    );
                    return updated;
                  });
                  console.log("Moved waypoint:", closest.id);
                } else {
                  const wp: Waypoint = {
                    id: crypto.randomUUID(),
                    x: pos.x,
                    y: pos.y,
                    yaw: 0,
                  };

                  setWaypoints((prev) => [...prev, wp]);
                  console.log("Added waypoint:", wp.id);
                }
              }

              if (mode === "DELETE") {
                const closest = findClosestWaypoint(pos.x, pos.y, 0.5);
                if (closest) {
                  setWaypoints((prev) =>
                    prev.filter((wp) => wp.id !== closest.id)
                  );
                  console.log("Deleted waypoint:", closest.id);
                }
              }
            }
          }
        }
        done();
      };

      return () => {
        ctx.onRender = undefined;
      };
    }, [mode, waypoints]);

    function publishWaypoints() {
      const msg = {
        header: {
          frame_id: "map",
          stamp: {
            sec: Math.floor(Date.now() / 1000),
            nanosec: (Date.now() % 1000) * 1e6,
          },
        },
        poses: waypoints.map((wp) => ({
          position: {
            x: wp.x,
            y: wp.y,
            z: 0,
          },
          orientation: {
            x: 0,
            y: 0,
            z: Math.sin(wp.yaw / 2),
            w: Math.cos(wp.yaw / 2),
          },
        })),
      };

      ctx.publish?.("/mission/waypoints", msg);
      console.log("Published waypoints:", msg);
    }

    function clearWaypoints() {
      setWaypoints([]);
      console.log("Cleared all waypoints");
    }

    return (
      <div
        style={{
          padding: 16,
          height: "100%",
          fontFamily: "sans-serif",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#fafafa",
        }}
      >
        <h3 style={{ margin: "0 0 16px 0", color: "#333" }}>
          Mission Manager
        </h3>

        <div
          style={{
            padding: "12px",
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e0e0e0",
            marginBottom: 16,
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <b>Mode:</b>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["OFF", "MODIFY", "DELETE"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m as Mode)}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  backgroundColor:
                    mode === m ? "#4caf50" : "#f5f5f5",
                  color: mode === m ? "white" : "#333",
                  border:
                    mode === m
                      ? "2px solid #4caf50"
                      : "2px solid #e0e0e0",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontWeight: mode === m ? "bold" : "normal",
                  fontSize: "14px",
                  transition: "all 0.2s",
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: "12px",
            backgroundColor: "#e3f2fd",
            borderRadius: 8,
            border: "1px solid #90caf9",
            marginBottom: 16,
            fontSize: "13px",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>
            Instructions:
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <b>MODIFY:</b> Click on 3D panel to add waypoint,
              or click near existing waypoint to move it
            </li>
            <li>
              <b>DELETE:</b> Click near waypoint on 3D panel to
              delete it
            </li>
          </ul>
          <div
            style={{
              marginTop: 8,
              padding: 8,
              backgroundColor: "white",
              borderRadius: 4,
              fontSize: "12px",
            }}
          >
            💡 <b>Tip:</b> Enable "Publish click" in 3D panel
            settings (topic: <code>/clicked_point</code>)
          </div>
        </div>

        <div
          style={{
            padding: "12px",
            backgroundColor: "white",
            borderRadius: 8,
            border: "1px solid #e0e0e0",
            marginBottom: 16,
            flex: 1,
            overflow: "auto",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Waypoints ({waypoints.length})</span>
            {waypoints.length > 0 && (
              <button
                onClick={clearWaypoints}
                style={{
                  padding: "4px 12px",
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                Clear All
              </button>
            )}
          </div>
          {waypoints.length === 0 ? (
            <div
              style={{
                color: "#999",
                fontSize: "13px",
                fontStyle: "italic",
                textAlign: "center",
                padding: "20px",
              }}
            >
              No waypoints yet. Click on the 3D panel to add
              waypoints.
            </div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {waypoints.map((wp, i) => (
                <li
                  key={wp.id}
                  style={{ marginBottom: 4, fontSize: "13px" }}
                >
                  <b>WP{i + 1}:</b> ({wp.x.toFixed(2)},{" "}
                  {wp.y.toFixed(2)})
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={publishWaypoints}
          disabled={waypoints.length === 0}
          style={{
            padding: "12px 20px",
            backgroundColor:
              waypoints.length === 0 ? "#ccc" : "#4caf50",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor:
              waypoints.length === 0 ? "not-allowed" : "pointer",
            fontWeight: "bold",
            fontSize: "15px",
            transition: "all 0.2s",
          }}
        >
          Publish Waypoints to /mission/waypoints
        </button>

        <div
          style={{
            marginTop: 12,
            padding: 8,
            backgroundColor: "#f5f5f5",
            borderRadius: 4,
            fontSize: "11px",
            color: "#666",
            textAlign: "center",
          }}
        >
          Current Mode: <b>{mode}</b>
        </div>
      </div>
    );
  }

  root.render(<Panel />);
}