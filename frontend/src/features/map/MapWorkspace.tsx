import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import type maplibregl from "maplibre-gl";
import { getMapBounds } from "../../api/mapApi";

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
  // duration: 0 (no animation), deliberately, for both the initial fit and the
  // "F" recenter shortcut — maplibre-gl's animated fitBounds/easeTo path has a
  // reproducible internal bug (throws from its own render loop; reproduces
  // with duration>0 regardless of StrictMode or load timing) under this
  // environment's rendering conditions. An instant jump carries no such risk.
  const fitToMap = useCallback(async () => {
    if (!map) return;
    try {
      const bounds = await getMapBounds();
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 60, duration: 0 },
      );
    } catch {
      // Map bounds unavailable (e.g. Lanelet2 map not loaded server-side) — keep the default view.
    }
  }, [map]);

  // Fit once per distinct map instance (not just once ever) — tracking the
  // instance itself, rather than a plain boolean, means a StrictMode dev-mode
  // remount (which tears down and recreates the Map) still gets a fresh fit
  // instead of silently skipping it or calling fitBounds on an already-removed
  // map if the in-flight bounds fetch resolves after that remount happened.
  const firstFittedMapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ready || !map || firstFittedMapRef.current === map) return;
    let cancelled = false;

    (async () => {
      if (!map) return;
      try {
        const bounds = await getMapBounds();
        if (cancelled) return;
        map.fitBounds(
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.north],
          ],
          { padding: 60, duration: 0 },
        );
        firstFittedMapRef.current = map;
      } catch {
        // Map bounds unavailable — keep the default view; don't mark as fitted
        // so a later map instance (or a later attempt) still gets a chance.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, map]);

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
            color: "#adb5bd",
            fontSize: 14,
          }}
        >
          Loading map…
        </div>
      )}
      {ready && children}
      <style>{`
        @keyframes anomaly-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(224,49,49,0.7); }
          70%  { box-shadow: 0 0 0 10px rgba(224,49,49,0); }
          100% { box-shadow: 0 0 0 0 rgba(224,49,49,0); }
        }
      `}</style>
    </div>
  );
}
