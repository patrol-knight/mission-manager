import { useState } from "react";
import { MapView } from "./mapview";
import { useWaypoint } from "./waypoint";
import { publishMission } from "./publisher";

export default function App() {
  const waypoints = useWaypoint((s) => s.waypoints);
  const mode = useWaypoint((s) => s.mode);
  const setMode = useWaypoint((s) => s.setMode);
  const [isWaypointListExpanded, setIsWaypointListExpanded] = useState(false);
  const [showNotification, setShowNotification] = useState(false);

  const handlePublishMission = () => {
    publishMission(waypoints);
    
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
    }, 1000);
  };

  // Sliding highlight position
  const modeOrder = ["off", "init", "modify", "delete"];
  const modeIndex = modeOrder.indexOf(mode);
  // Each button is ~48px tall + 4px gap
  const ITEM_H = 48;
  const GAP = 4;

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
            {/* Sliding highlight */}
            <div style={{
              position: "absolute",
              top: 4,
              left: 4,
              right: 4,
              height: ITEM_H,
              background: 
                mode === "off"    ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" :
                mode === "init"   ? "linear-gradient(135deg, #f7971e 0%, #ffd200 100%)" :
                mode === "modify" ? "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)" :
                                    "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
              borderRadius: 8,
              transform: `translateY(${modeIndex * (ITEM_H + GAP)}px)`,
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }} />

            <div style={{ 
              display: "flex", 
              flexDirection: "column", 
              gap: GAP,
              position: "relative",
              zIndex: 1,
            }}>
              {(["off", "init", "modify", "delete"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    height: ITEM_H,
                    padding: "0 16px",
                    background: "transparent",
                    color: mode === m ? "white" : "#6c757d",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                    fontWeight: mode === m ? 600 : 500,
                    fontSize: 15,
                    transition: "color 0.3s ease",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    textAlign: "left",
                  }}
                >
                  <span style={{ textTransform: "capitalize" }}>{m === "init" ? "Initialize" : m}</span>
                </button>
              ))}
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
            {mode === "off"    && "No interaction with map"}
            {mode === "init"   && "Click & drag on map to set robot initial pose"}
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

        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <MapView />
      </div>

      {/* Notification Popup */}
      {showNotification && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "white",
            borderRadius: 16,
            padding: "32px 48px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            zIndex: 10000,
            minWidth: 400,
            textAlign: "center",
            animation: "slideIn 0.3s ease-out",
          }}
        >
          <button
            onClick={() => setShowNotification(false)}
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 32,
              height: 32,
              background: "transparent",
              border: "none",
              borderRadius: "50%",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s ease",
              color: "#6c757d",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#f8f9fa";
              e.currentTarget.style.color = "#212529";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "#6c757d";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
            </svg>
          </button>

          <div style={{
            width: 64,
            height: 64,
            margin: "0 auto 20px",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "scaleIn 0.5s ease-out",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17L4 12" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          
          <h3 style={{
            margin: "0 0 12px 0",
            fontSize: 24,
            fontWeight: 700,
            color: "#212529",
          }}>
            Mission Published!
          </h3>
          
          <p style={{
            margin: "0 0 8px 0",
            fontSize: 16,
            color: "#6c757d",
            fontWeight: 500,
          }}>
            {waypoints.length} waypoint{waypoints.length !== 1 ? 's' : ''} published successfully
          </p>
        </div>
      )}

      {/* Backdrop overlay */}
      {showNotification && (
        <div
          onClick={() => setShowNotification(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            zIndex: 9999,
            backdropFilter: "blur(4px)",
            animation: "fadeIn 0.3s ease-out",
          }}
        />
      )}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translate(-50%, -60%); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          0%   { transform: scale(0); }
          50%  { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}