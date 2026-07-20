import { useEffect } from "react";
import type maplibregl from "maplibre-gl";

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
): void {
  useEffect(() => {
    if (!map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: EMPTY });
      map.addLayer({ id: layerId, type: "line", source: sourceId, paint });
    }

    const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
    source.setData(route ? { type: "FeatureCollection", features: [route] } : EMPTY);

    return () => {
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(EMPTY);
      }
    };
    // `paint` is deliberately omitted — it's static per call site, and including
    // it would tear down and recreate the layer (losing render order) every
    // time the caller passes a fresh object literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, route, sourceId, layerId]);
}
