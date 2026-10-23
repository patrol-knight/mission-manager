import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type maplibregl from "maplibre-gl";
import { getMapBounds } from "../../api/mapApi";
import { useDeviceStore } from "../../stores/deviceStore";
import { overviewBounds, type LngLatBoundsLike } from "./overviewBounds";

/** Fit the whole map plus a margin around every device (see overviewBounds),
 * so a tower at the map's edge, and the anomalies in front of it, are never
 * left out. Only runs on F and for the first view. */
async function fitOverview(map: maplibregl.Map, duration: number, cancelled = () => false): Promise<void> {
  let mapBounds: LngLatBoundsLike | null = null;
  try {
    const b = await getMapBounds();
    mapBounds = [
      [b.west, b.south],
      [b.east, b.north],
    ];
  } catch {
    // Map bounds unavailable (e.g. Lanelet2 map not loaded server-side) -- devices only.
  }
  if (cancelled()) return; // the map may have been torn down meanwhile (StrictMode remount)
  const bounds = overviewBounds(mapBounds, Object.values(useDeviceStore.getState().devices));
  if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 19, duration });
}

interface MapWorkspaceProps {
  containerRef: RefObject<HTMLDivElement | null>;
  map: maplibregl.Map | null;
  ready: boolean;
  children?: ReactNode;
}

/**
 * Renders the map container and the loading overlay. The Map instance itself
 * (via useMapInstance) and MapContext.Provider live in AppShell — hoisted there
 * so RightPanel (the Mission Editor's list-click "center on map" affordance) can
 * also reach the map, not just the layers mounted as MapWorkspace's children.
 * MapWorkspace never unmounts across monitor/editor transitions — only the layer
 * set underneath changes — which is what preserves map position/zoom with no
 * special-casing.
 */
export function MapWorkspace({ containerRef, map, ready, children }: MapWorkspaceProps) {
  // "F" recenters on the overview, animated. The first view is an instant
  // overview fit, redone once when the first devices arrive (they usually
  // come a moment after the map loads) -- never again after that, so it
  // doesn't fight the operator's own panning.
  const fitToMap = useCallback(async () => {
    if (map) await fitOverview(map, 600);
  }, [map]);

  const fittedMapRef = useRef<maplibregl.Map | null>(null);
  const fittedWithDevicesRef = useRef<maplibregl.Map | null>(null);
  const hasDevices = useDeviceStore((s) => Object.keys(s.devices).length > 0);

  useEffect(() => {
    if (!ready || !map || fittedWithDevicesRef.current === map) return;
    if (fittedMapRef.current === map && !hasDevices) return;
    let cancelled = false;
    // Marked done only once the fit actually ran, so a StrictMode remount
    // that cancels the first attempt still gets its fit.
    void fitOverview(map, 0, () => cancelled).then(() => {
      if (cancelled) return;
      fittedMapRef.current = map;
      if (hasDevices) fittedWithDevicesRef.current = map;
    });
    return () => {
      cancelled = true;
    };
  }, [ready, map, hasDevices]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if ((e.key === "f" || e.key === "F") && tag !== "INPUT" && tag !== "TEXTAREA") {
        fitToMap();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fitToMap]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {!ready && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,15,20,0.7)",
            color: "var(--color-text-disabled)",
            fontSize: "var(--text-base)",
          }}
        >
          Loading map…
        </div>
      )}
      {ready && children}
    </div>
  );
}
