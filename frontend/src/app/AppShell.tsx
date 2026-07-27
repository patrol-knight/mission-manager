import { useRef, useState } from "react";
import { TopBar } from "./TopBar";
import { RightPanel } from "./RightPanel";
import { useRealtimeSubscription } from "../hooks/useRealtimeSubscription";
import { useMapInstance } from "../features/map/useMapInstance";
import { MapContext } from "../features/map/MapContext";
import { MapWorkspace } from "../features/map/MapWorkspace";
import { LaneletLayer } from "../features/map/LaneletLayer";
import { DeviceMarkerLayer } from "../features/devices/DeviceMarkerLayer";
import { AnomalyLayer } from "../features/map/AnomalyLayer";
import { WaypointEditorLayer } from "../features/map/WaypointEditorLayer";
import { MissionRouteLayer } from "../features/map/MissionRouteLayer";
import { CurrentMissionRouteLayer } from "../features/map/CurrentMissionRouteLayer";
import { DiversionRouteLayer } from "../features/map/DiversionRouteLayer";
import { DiversionTargetMarkerLayer } from "../features/map/DiversionTargetMarkerLayer";
import { MissionWaypointMarkersLayer } from "../features/map/MissionWaypointMarkersLayer";
import { MapEditorToolbar } from "../features/missions/MapEditorToolbar";
import { MissionEditorProvider } from "../features/missions/MissionEditorContext";
import { DeviceInspectorProvider } from "../features/devices/DeviceInspectorProvider";
import { DeviceInspectorOverlay } from "../features/devices/DeviceInspectorOverlay";
import { AnomalyVerifyProvider } from "../features/anomalies/AnomalyVerifyProvider";
import { AnomalyVerifyModal } from "../features/anomalies/AnomalyVerifyModal";
import { AnomalyArrivalWatcher } from "../features/anomalies/AnomalyArrivalWatcher";
import { DiversionNotifier } from "../features/anomalies/DiversionNotifier";
import { MissionCompleteWatcher } from "../features/missions/MissionCompleteWatcher";

export function AppShell() {
  useRealtimeSubscription();

  const [view, setView] = useState<"monitor" | "library" | "editor">("monitor");
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useMapInstance(containerRef);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw" }}>
      <TopBar />
      <MapContext.Provider value={{ map, ready }}>
        <MissionEditorProvider>
          <DeviceInspectorProvider>
            <AnomalyVerifyProvider>
              <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
                <div style={{ flex: 1, position: "relative" }}>
                  <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
                    <LaneletLayer />
                    {view === "editor" ? (
                      <>
                        <MissionRouteLayer />
                        <WaypointEditorLayer />
                      </>
                    ) : (
                      <>
                        <CurrentMissionRouteLayer />
                        <MissionWaypointMarkersLayer />
                      </>
                    )}
                    {view === "monitor" && <AnomalyLayer />}
                    {view === "monitor" && <DiversionRouteLayer />}
                    {view === "monitor" && <DiversionTargetMarkerLayer />}
                    {view === "monitor" && <DeviceMarkerLayer />}
                    {view === "editor" && <MapEditorToolbar />}
                  </MapWorkspace>
                </div>
                <RightPanel
                  view={view}
                  onOpenLibrary={() => setView("library")}
                  onCloseLibrary={() => setView("monitor")}
                  onEnterEditor={() => setView("editor")}
                  onExitEditorToLibrary={() => setView("library")}
                />
              </div>
              <DeviceInspectorOverlay />
              <AnomalyVerifyModal />
              <AnomalyArrivalWatcher />
              <DiversionNotifier />
              <MissionCompleteWatcher />
            </AnomalyVerifyProvider>
          </DeviceInspectorProvider>
        </MissionEditorProvider>
      </MapContext.Provider>
    </div>
  );
}
