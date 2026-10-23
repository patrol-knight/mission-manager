import { useEffect, useRef, useState, type RefObject } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    // No layer maxzoom: a layer is hidden at zoom >= its maxzoom, so the old
    // `maxzoom: 22` (the map's own max) blanked the map when fully zoomed in.
    // Past the source's maxzoom (19) MapLibre scales up the z19 tiles.
    { id: "osm-tiles", type: "raster", source: "osm" },
  ],
};

interface PendingRemoval {
  instance: maplibregl.Map;
  cancelled: boolean;
}

/** Creates the maplibre Map exactly once against the given container and tears it
 * down on unmount. `MapWorkspace` is the only caller — every layer reads the
 * resulting instance via MapContext instead of constructing its own. */
export function useMapInstance(containerRef: RefObject<HTMLDivElement | null>): {
  map: maplibregl.Map | null;
  ready: boolean;
} {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // Survives React StrictMode's dev-mode double-invoke (effect -> cleanup -> effect,
  // synchronously within one commit): if the previous cleanup's removal is still
  // pending when the effect re-runs against the same container, cancel it and reuse
  // that instance instead of constructing a second Map on top of the first — two
  // Maps fighting over one container corrupts the canvas (visibly wrong size/position)
  // and can throw from inside maplibre's own render loop.
  const pendingRemovalRef = useRef<PendingRemoval | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let instance: maplibregl.Map;

    if (pendingRemovalRef.current) {
      pendingRemovalRef.current.cancelled = true;
      instance = pendingRemovalRef.current.instance;
      pendingRemovalRef.current = null;
      setMap(instance);
      if (instance.loaded()) setReady(true);
    } else {
      instance = new maplibregl.Map({
        container,
        style: OSM_STYLE,
        center: [121.5, 25.0],
        zoom: 17,
        maxZoom: 22,
        pitchWithRotate: false,
      });
      instance.on("load", () => setReady(true));
      setMap(instance);
    }

    return () => {
      const pending: PendingRemoval = { instance, cancelled: false };
      pendingRemovalRef.current = pending;

      const doRemove = () => {
        if (pending.cancelled) return;
        instance.remove();
        setMap(null);
        setReady(false);
      };

      // Deferring even the "already loaded" case by a microtask gives a
      // synchronous StrictMode re-invoke a chance to cancel this first.
      if (instance.loaded()) {
        queueMicrotask(doRemove);
      } else {
        instance.once("load", doRemove);
      }
    };
  }, [containerRef]);

  return { map, ready };
}
