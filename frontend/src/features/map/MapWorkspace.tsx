import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type maplibregl from "maplibre-gl";
import { getMapBounds } from "../../api/mapApi";
import { useDeviceStore } from "../../stores/deviceStore";
import { overviewBounds, type LngLatBoundsLike } from "./overviewBounds";
import styles from "./MapWorkspace.module.css";

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
  // Set while an overview fit is moving the map, so its moveend reads as
  // "back at the overview" rather than "moved away".
  const fittingRef = useRef(false);
  const fitToMap = useCallback(async () => {
    if (!map) return;
    fittingRef.current = true;
    await fitOverview(map, 600);
  }, [map]);

  // The Overview button only shows once the view has left the overview
  // (a pan, a zoom, a fly to a tower) -- like a map app's re-centre button --
  // so it costs no room the rest of the time.
  const [awayFromOverview, setAwayFromOverview] = useState(false);
  useEffect(() => {
    if (!map) return;
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) fittingRef.current = false; // the operator took over
    };
    const onMoveEnd = () => {
      setAwayFromOverview(!fittingRef.current);
      fittingRef.current = false;
    };
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    return () => {
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
    };
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
    fittingRef.current = true;
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
      {ready && (
        <button
          type="button"
          className={styles.overview}
          data-visible={awayFromOverview}
          tabIndex={awayFromOverview ? 0 : -1}
          onClick={() => void fitToMap()}
          data-hint="Show the whole site (F)"
        >
          Overview
        </button>
      )}
    </div>
  );
}
