import { useContext, useEffect } from "react";
import { MapContext } from "./MapContext";
import { useLaneletMap } from "../../hooks/useMapData";

const LAYER_IDS = ["ll-arrows", "ll-center", "ll-right", "ll-left"];

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
    map.addLayer({
      id: "ll-left",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "left"],
      paint: { "line-color": "#555555", "line-width": 2 },
    });
    map.addLayer({
      id: "ll-right",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "right"],
      paint: { "line-color": "#555555", "line-width": 2 },
    });
    map.addLayer({
      id: "ll-center",
      type: "line",
      source: "lanelet",
      filter: ["==", ["get", "type"], "center"],
      paint: { "line-color": "#555555", "line-width": 1.5, "line-dasharray": [4, 3] },
    });

    const arrowSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="19,10 5,3 8,10 5,17" fill="#555555"/></svg>';
    const blob = new Blob([arrowSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image(20, 20);
    img.onload = () => {
      if (!map.hasImage("arrow-icon")) map.addImage("arrow-icon", img, { sdf: false });
      if (map.getLayer("ll-arrows")) map.removeLayer("ll-arrows");
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
      });
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
