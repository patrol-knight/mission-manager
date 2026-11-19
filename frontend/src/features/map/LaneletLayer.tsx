import { useContext, useEffect } from "react";
import type * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { useLaneletMap } from "../../hooks/useMapData";
import { mapPalette } from "./mapPalette";
import { HEATMAP_LAYER_ID } from "./HeatmapLayer";

const LAYER_IDS = ["ll-arrows", "ll-center", "ll-right", "ll-left"];

/** Id of the layer drawn right after `layerId`, to insert new layers in
 * front of -- undefined (the very top) if there is none. */
function layerAfter(map: maplibregl.Map, layerId: string): string | undefined {
  const layers = map.getStyle().layers;
  const index = layers.findIndex((l) => l.id === layerId);
  return index >= 0 ? layers[index + 1]?.id : undefined;
}

export function LaneletLayer() {
  const { map } = useContext(MapContext);
  const { geojson } = useLaneletMap();

  useEffect(() => {
    if (!map || !geojson) return;

    LAYER_IDS.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource("lanelet")) map.removeSource("lanelet");

    map.addSource("lanelet", { type: "geojson", data: geojson });
    // The map data arrives after the route and FOV layers may already exist,
    // so insert just above the OSM tiles (and the heatmap) -- under
    // everything else -- rather than on top of the mission route.
    const beforeId = layerAfter(map, map.getLayer(HEATMAP_LAYER_ID) ? HEATMAP_LAYER_ID : "osm-tiles");
    map.addLayer({
      id: "ll-left",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "left"],
      paint: { "line-color": mapPalette.lanelet, "line-width": 2 },
    }, beforeId);
    map.addLayer({
      id: "ll-right",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "right"],
      paint: { "line-color": mapPalette.lanelet, "line-width": 2 },
    }, beforeId);
    map.addLayer({
      id: "ll-center",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "center"],
      paint: { "line-color": mapPalette.lanelet, "line-width": 1.5, "line-dasharray": [4, 3] },
    }, beforeId);

    const arrowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="19,10 5,3 8,10 5,17" fill="${mapPalette.lanelet}"/></svg>`;
    const blob = new Blob([arrowSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image(20, 20);
    img.onload = () => {
      if (!map.hasImage("arrow-icon")) map.addImage("arrow-icon", img, { sdf: false });
      if (map.getLayer("ll-arrows")) map.removeLayer("ll-arrows");
      if (!map.getLayer("ll-center")) return; // torn down while the icon loaded
      map.addLayer({
        id: "ll-arrows",
        type: "symbol",
        source: "lanelet",
        filter: ["==", ["get", "type"], "center"],
        layout: {
          "symbol-placement": "line",
          "symbol-spacing": 50,
          "icon-image": "arrow-icon",
          "icon-size": 1,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      }, layerAfter(map, "ll-center"));
      URL.revokeObjectURL(url);
    };
    img.src = url;

    return () => {
      LAYER_IDS.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource("lanelet")) map.removeSource("lanelet");
    };
  }, [map, geojson]);

  return null;
}
