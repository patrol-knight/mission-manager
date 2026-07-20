import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface UseMarkerListOptions<T> {
  keyOf: (item: T) => string;
  project: (item: T) => Promise<LngLat | null>;
  buildElement: (item: T) => HTMLElement;
  /** Called on every apply (including for markers that already existed) so a
   * layer can update in-place (rotation, color) without recreating the marker. */
  updateElement?: (el: HTMLElement, item: T) => void;
  onClick?: (item: T) => void;
  draggable?: (item: T) => boolean;
  onDragEnd?: (item: T, lngLat: LngLat, marker: maplibregl.Marker) => void;
}

/**
 * Generic marker-diffing hook shared by every marker-based map layer
 * (devices, waypoints, anomalies) — replaces the near-duplicate "clear all,
 * recreate all" effects the old MapView.tsx had one of per marker kind.
 */
export function useMarkerList<T>(
  map: maplibregl.Map | null,
  items: T[],
  options: UseMarkerListOptions<T>,
): void {
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const opts = optionsRef.current;
    const runId = Math.random().toString(36).slice(2, 8);
    console.log(`[markers ${runId}] effect start, items=${items.length}, existing markers=${markersRef.current.size}`);

    Promise.all(
      items.map(async (item) => {
        const pos = await opts.project(item);
        return pos ? { item, pos } : null;
      }),
    )
      .then((resolved) => {
        console.log(`[markers ${runId}] resolved=${resolved.filter(Boolean).length}/${resolved.length}, cancelled=${cancelled}`);
        if (cancelled) return;
        const seen = new Set<string>();

        for (const entry of resolved) {
          if (!entry) continue;
          const { item, pos } = entry;
          const key = opts.keyOf(item);
          seen.add(key);

          let marker = markersRef.current.get(key);
          if (!marker) {
            const el = opts.buildElement(item);
            if (opts.onClick) {
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                optionsRef.current.onClick?.(item);
              });
            }
            marker = new maplibregl.Marker({
              element: el,
              anchor: "center",
              draggable: opts.draggable?.(item) ?? false,
            }).addTo(map);
            if (opts.onDragEnd) {
              const createdMarker = marker;
              createdMarker.on("dragend", () => {
                const ll = createdMarker.getLngLat();
                optionsRef.current.onDragEnd?.(item, { lng: ll.lng, lat: ll.lat }, createdMarker);
              });
            }
            markersRef.current.set(key, marker);
          }
          marker.setLngLat([pos.lng, pos.lat]);
          if (opts.draggable) marker.setDraggable(opts.draggable(item));
          opts.updateElement?.(marker.getElement(), item);
        }

        for (const [key, marker] of markersRef.current) {
          if (!seen.has(key)) {
            marker.remove();
            markersRef.current.delete(key);
          }
        }
        console.log(`[markers ${runId}] done, final size=${markersRef.current.size}`);
      })
      .catch((err: unknown) => {
        console.warn("[map] marker projection failed:", err);
      });

    return () => {
      console.log(`[markers ${runId}] cleanup, cancelling`);
      cancelled = true;
    };
  }, [map, items]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, []);
}
