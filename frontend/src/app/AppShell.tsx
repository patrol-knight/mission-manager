import { useRef, useState } from "react";
import type { PanelView } from "./RightPanel";
import { RightPanel } from "./RightPanel";
import { useRealtimeSubscription } from "../hooks/useRealtimeSubscription";
import { useMapInstance } from "../features/map/useMapInstance";
import { MapContext } from "../features/map/MapContext";
import { MapWorkspace } from "../features/map/MapWorkspace";
import { LaneletLayer } from "../features/map/LaneletLayer";
import { TowerFovLayer } from "../features/map/TowerFovLayer";
import { DeviceMarkerLayer } from "../features/devices/DeviceMarkerLayer";
import { AnomalyLayer } from "../features/map/AnomalyLayer";
import { WaypointEditorLayer } from "../features/map/WaypointEditorLayer";
import { MissionRouteLayer } from "../features/map/MissionRouteLayer";
import { CurrentMissionRouteLayer } from "../features/map/CurrentMissionRouteLayer";
import { InvestigationRouteLayer } from "../features/map/InvestigationRouteLayer";
import { InvestigationTargetLayer } from "../features/map/InvestigationTargetLayer";
import { MissionWaypointMarkersLayer } from "../features/map/MissionWaypointMarkersLayer";
import { MissionPreviewLayer } from "../features/map/MissionPreviewLayer";
import { MissionEditorProvider } from "../features/missions/MissionEditorContext";
import { DeviceInspectorProvider } from "../features/devices/DeviceInspectorProvider";
import { DeviceInspectorOverlay } from "../features/devices/DeviceInspectorOverlay";
import { VerifyModal } from "../features/investigation/VerifyModal";
import { InvestigationNotifier } from "../features/investigation/InvestigationNotifier";
import { MissionCompleteWatcher } from "../features/missions/MissionCompleteWatcher";

export function AppShell() {
  useRealtimeSubscription();

  const [view, setView] = useState<PanelView>("monitor");
  // Where leaving the editor goes: back to the library or the monitor view,
  // whichever it was opened from.
  const [editorReturn, setEditorReturn] = useState<"monitor" | "library">("library");
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useMapInstance(containerRef);
  // The tower list is a monitor view too: the live map stays as it is.
  const liveMap = view === "monitor" || view === "towers";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", background: "var(--color-bg)" }}>
      <MapContext.Provider value={{ map, ready }}>
        <MissionEditorProvider>
          <DeviceInspectorProvider>
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, position: "relative" }}>
                <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
                  <LaneletLayer />
                  {/* Orange = the active mission (monitor only); the library and
                      the editor show just their own mission, in blue. */}
                  {liveMap && (
                    <>
                      <CurrentMissionRouteLayer />
                      <MissionWaypointMarkersLayer />
                    </>
                  )}
                  {view === "library" && <MissionPreviewLayer />}
                  {view === "editor" && (
                    <>
                      <MissionRouteLayer />
                      <WaypointEditorLayer />
                    </>
                  )}
                  {liveMap && <TowerFovLayer />}
                  {liveMap && <AnomalyLayer />}
                  {liveMap && <InvestigationRouteLayer />}
                  {liveMap && <InvestigationTargetLayer />}
                  {liveMap && <DeviceMarkerLayer />}
                </MapWorkspace>
              </div>
              <RightPanel
                view={view}
                onOpenLibrary={() => setView("library")}
                onCloseLibrary={() => setView("monitor")}
                onOpenTowers={() => setView("towers")}
                onCloseTowers={() => setView("monitor")}
                onEnterEditor={(returnTo) => {
                  setEditorReturn(returnTo);
                  setView("editor");
                }}
                onExitEditor={() => setView(editorReturn)}
              />
            </div>
            <DeviceInspectorOverlay />
            <VerifyModal />
            <InvestigationNotifier />
            <MissionCompleteWatcher />
          </DeviceInspectorProvider>
        </MissionEditorProvider>
      </MapContext.Provider>
    </div>
  );
}
