import { useEffect, useRef } from "react";
import type * as maplibregl from "maplibre-gl";

type PaintKey = Parameters<maplibregl.Map["setPaintProperty"]>[1];

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Shared "create a geojson line source+layer once, setData on change, clear on
 * unmount" logic — used by both the editor's MissionRouteLayer (draft's last
 * Validate Route result) and the monitor's CurrentMissionRouteLayer (the
 * persisted mission's auto-computed route), which would otherwise duplicate
 * this exact effect.
 */
export function useGeoJsonLineLayer(
  map: maplibregl.Map | null,
  sourceId: string,
  layerId: string,
  route: GeoJSON.Feature<GeoJSON.LineString> | null,
  paint: maplibregl.LineLayerSpecification["paint"],
  // When true, the layer is (re-)moved to the very top of the GL layer stack
  // on every run, so callers like InvestigationRouteLayer stay above the mission
  // route/lanelet layers regardless of mount order or what else gets added.
  moveToTop = false,
): void {
  useEffect(() => {
    if (!map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: EMPTY });
      map.addLayer({ id: layerId, type: "line", source: sourceId, paint });
    }
    if (moveToTop) map.moveLayer(layerId);

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    source.setData(route ? { type: "FeatureCollection", features: [route] } : EMPTY);

    return () => {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(EMPTY);
      }
    };
    // `paint` is deliberately omitted here — it's read only once, at layer
    // creation, by design (see the second effect below for reactive paint).
    // Including it in this effect's deps would tear down and recreate the
    // layer (losing render order) on every paint change instead of just
    // restyling it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route, sourceId, layerId, moveToTop]);

  // Separate effect: push paint property changes onto the existing layer via
  // setPaintProperty, without recreating it (which the effect above avoids
  // on purpose). Properties the previous paint set but this one doesn't are
  // reset to their default -- e.g. MissionPreviewLayer's dashed route turning
  // solid. Callers that want a reactive paint should keep their paint objects
  // stable (constants or useMemo) so this only fires on a real change.
  const appliedKeysRef = useRef<PaintKey[]>([]);
  useEffect(() => {
    if (!map || !paint || !map.getLayer(layerId)) return;
    for (const key of appliedKeysRef.current) {
      if (!(key in paint)) map.setPaintProperty(layerId, key, undefined);
    }
    for (const [key, value] of Object.entries(paint)) {
      map.setPaintProperty(layerId, key as PaintKey, value);
    }
    appliedKeysRef.current = Object.keys(paint) as PaintKey[];
  }, [map, layerId, paint]);
}
