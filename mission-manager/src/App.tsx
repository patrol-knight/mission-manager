import { useState } from "react";
import { MapView } from "./mapview";
import { useWaypoint } from "./waypoint";
import { publishMission } from "./publisher";

export default function App() {
  const waypoints = useWaypoint((s) => s.waypoints);
  const mode = useWaypoint((s) => s.mode);
  const setMode = useWaypoint((s) => s.setMode);
  const [isWaypointListExpanded, setIsWaypointListExpanded] = useState(false);

  const handlePublishMission = () => {
    publishMission(waypoints);
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <div
        style={{
          width: "20%",
          minWidth: 280,
          maxWidth: 400,
          padding: 20,
          background: "linear-gradient(180deg, #f8f9fa 0%, #e9ecef 100%)",
          overflowY: "auto",
          boxShadow: "4px 0 12px rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2 style={{ 
          margin: "0 0 24px 0", 
          fontSize: 24, 
          fontWeight: 600,
          color: "#212529"
        }}>
          Mission Editor
        </h2>

        <div style={{ marginBottom: 24 }}>
          <h4 style={{ 
            margin: "0 0 12px 0", 
            fontSize: 14, 
            fontWeight: 600,
            color: "#495057",
            textTransform: "uppercase",
            letterSpacing: "0.5px"
          }}>
            Mode
          </h4>
          
          <div style={{
            background: "#fff",
            borderRadius: 12,
            padding: 4,
            boxShadow: "inset 0 2px 4px rgba(0,0,0,0.06)",
            position: "relative",
          }}>
            <div style={{
              position: "absolute",
              top: 4,
              left: 4,
              right: 4,
              height: "calc(33.333% - 2.67px)",
              background: 
                mode === "off" ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" :
                mode === "modify" ? "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" :
                "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
              borderRadius: 8,
              transform: 
                mode === "off" ? "translateY(0)" :
                mode === "modify" ? "translateY(calc(100% + 4px))" :
                "translateY(calc(200% + 8px))",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }} />

            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: 4,
              position: "relative",
              zIndex: 1,
            }}>
              <button
                onClick={() => setMode("off")}
                style={{
                  padding: "12px 16px",
                  background: "transparent",
                  color: mode === "off" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: mode === "off" ? 600 : 500,
                  fontSize: 15,
                  transition: "color 0.3s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>Off</span>
              </button>
              <button
                onClick={() => setMode("modify")}
                style={{
                  padding: "12px 16px",
                  background: "transparent",
                  color: mode === "modify" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: mode === "modify" ? 600 : 500,
                  fontSize: 15,
                  transition: "color 0.3s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>Modify</span>
              </button>
              <button
                onClick={() => setMode("delete")}
                style={{
                  padding: "12px 16px",
                  background: "transparent",
                  color: mode === "delete" ? "white" : "#6c757d",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: mode === "delete" ? 600 : 500,
                  fontSize: 15,
                  transition: "color 0.3s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>Delete</span>
              </button>
            </div>
          </div>
          
          <div style={{ 
            marginTop: 12, 
            padding: 12, 
            background: "#fff", 
            borderRadius: 8,
            fontSize: 13,
            color: "#6c757d",
            lineHeight: 1.5,
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}>
            {mode === "off" && "No interaction with map"}
            {mode === "modify" && "Click empty space to add, drag waypoint to move"}
            {mode === "delete" && "Click waypoint to delete"}
          </div>
        </div>

        <button
          onClick={handlePublishMission}
          disabled={waypoints.length === 0}
          style={{
            padding: "14px 20px",
            background: waypoints.length === 0 
              ? "#adb5bd" 
              : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            border: "none",
            borderRadius: 10,
            cursor: waypoints.length === 0 ? "not-allowed" : "pointer",
            width: "100%",
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 20,
            boxShadow: waypoints.length === 0 
              ? "none" 
              : "0 4px 12px rgba(102, 126, 234, 0.4)",
            transition: "all 0.3s ease",
            transform: waypoints.length === 0 ? "none" : "translateY(0)",
          }}
          onMouseEnter={(e) => {
            if (waypoints.length > 0) {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 6px 16px rgba(102, 126, 234, 0.5)";
            }
          }}
          onMouseLeave={(e) => {
            if (waypoints.length > 0) {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(102, 126, 234, 0.4)";
            }
          }}
        >
          Publish Mission ({waypoints.length})
        </button>

        <div style={{ 
          background: "#fff",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}>
          <div
            onClick={() => setIsWaypointListExpanded(!isWaypointListExpanded)}
            style={{
              padding: "14px 16px",
              background: "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              userSelect: "none",
              transition: "background 0.2s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "linear-gradient(135deg, #e8ebf0 0%, #b8c6db 100%)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)";
            }}
          >
            <span style={{ 
              fontWeight: 600, 
              fontSize: 14,
              color: "#495057",
            }}>
              Waypoints ({waypoints.length})
            </span>
            <span style={{ 
              fontSize: 18,
              transition: "transform 0.3s ease",
              transform: isWaypointListExpanded ? "rotate(180deg)" : "rotate(0deg)",
              display: "inline-block",
            }}>
              ▼
            </span>
          </div>

          {/* Waypoint List Content */}
          <div style={{
            maxHeight: isWaypointListExpanded ? "400px" : "0",
            overflow: "hidden",
            transition: "max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          }}>
            <div style={{ 
              padding: isWaypointListExpanded ? "12px 0" : "0",
              maxHeight: 300,
              overflowY: "auto",
            }}>
              {waypoints.length === 0 ? (
                <div style={{
                  padding: "20px 16px",
                  textAlign: "center",
                  color: "#adb5bd",
                  fontSize: 13,
                }}>
                  No waypoints yet. Switch to Modify mode to add some!
                </div>
              ) : (
                <ul style={{ 
                  listStyle: "none", 
                  margin: 0, 
                  padding: 0,
                }}>
                  {waypoints.map((wp, i) => (
                    <li 
                      key={wp.id}
                      style={{
                        padding: "10px 16px",
                        borderBottom: i < waypoints.length - 1 ? "1px solid #e9ecef" : "none",
                        fontSize: 13,
                        color: "#495057",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        transition: "background 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#f8f9fa";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span style={{
                        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                        color: "white",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}>
                        {i + 1}
                      </span>
                      <span style={{ fontFamily: "monospace" }}>
                        ({wp.x.toFixed(2)}, {wp.y.toFixed(2)})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Spacer to push content to top */}
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapView />
      </div>
    </div>
  );
}