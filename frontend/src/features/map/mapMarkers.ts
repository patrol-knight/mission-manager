import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface UseMarkerListOptions<T> {
  keyOf: (item: T) => string;
  project: (item: T) => Promise<LngLat | null>;
  /** Optional: the fields project() actually reads (e.g. `(d) => [d.pose.x,
   * d.pose.y, d.pose.frameId]`). When provided, an item already in the list
   * is only re-projected (a network round trip) if one of these changed
   * since its last successful projection — otherwise every device's update
   * re-projects every marker's position, even ones that didn't move. */
  dependsOn?: (item: T) => readonly unknown[];
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
function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export function useMarkerList<T>(
  map: maplibregl.Map | null,
  items: T[],
  options: UseMarkerListOptions<T>,
  // Extra values that should force a full re-apply (including updateElement,
  // which normally only re-runs when `items` itself changes) even though
  // they aren't part of `items` -- e.g. a styling flag like "investigating"
  // or "backend connected" that every item's rendering depends on. Always
  // pass the same length/order for a given call site.
  extraRefreshDeps: readonly unknown[] = [],
): void {
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const projectionCacheRef = useRef<Map<string, { deps: readonly unknown[]; pos: LngLat }>>(new Map());

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const opts = optionsRef.current;
    const cache = projectionCacheRef.current;

    Promise.all(
      items.map(async (item) => {
        const key = opts.keyOf(item);
        const deps = opts.dependsOn?.(item);
        const cached = deps && cache.get(key);
        if (cached && sameDeps(cached.deps, deps)) {
          return { item, pos: cached.pos };
        }

        const pos = await opts.project(item);
        if (pos && deps) cache.set(key, { deps, pos });
        return pos ? { item, pos } : null;
      }),
    )
      .then((resolved) => {
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
            })
              .setLngLat([pos.lng, pos.lat])
              .addTo(map);
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
            cache.delete(key);
          }
        }
      })
      .catch((err: unknown) => {
        console.warn("[map] marker projection failed:", err);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, items, ...extraRefreshDeps]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      markers.forEach((m) => m.remove());
      markers.clear();
    };
  }, []);
}
