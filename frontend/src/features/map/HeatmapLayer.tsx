import { useContext, useEffect } from "react";
import type * as maplibregl from "maplibre-gl";
import { MapContext } from "./MapContext";
import { getHeatmap } from "../../api/mapApi";
import { heatmapDataUrl } from "./heatmapColormap";

export const HEATMAP_LAYER_ID = "anomaly-heatmap";
const SOURCE_ID = "anomaly-heatmap";
const OPACITY = 0.6;

/** Where anomalies happened before, under the lanelets, while editing a
 * mission. Fetched on every mount, so each edit shows the latest history. */
export function HeatmapLayer() {
  const { map } = useContext(MapContext);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    void getHeatmap()
      .then((view) => {
        const image = view.image;
        if (cancelled || !image) return;
        const coordinates = image.corners as [
          [number, number], [number, number], [number, number], [number, number],
        ];
        map.addSource(SOURCE_ID, { type: "image", url: heatmapDataUrl(image.width, image.height, image.data), coordinates });
        const layers = map.getStyle().layers;
        const beforeId = map.getLayer("ll-left")
          ? "ll-left"
          : layers[layers.findIndex((l) => l.id === "osm-tiles") + 1]?.id;
        map.addLayer({
          id: HEATMAP_LAYER_ID,
          type: "raster",
          source: SOURCE_ID,
          paint: {
            "raster-opacity": 0,
            "raster-opacity-transition": { duration: 300 },
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        }, beforeId);
        // Fainter when zoomed in, where the lanes matter more than the heat.
        const opacity: maplibregl.ExpressionSpecification = [
          "interpolate", ["linear"], ["zoom"], 18, OPACITY, 21, OPACITY * 0.6,
        ];
        requestAnimationFrame(() => {
          if (map.getLayer(HEATMAP_LAYER_ID)) map.setPaintProperty(HEATMAP_LAYER_ID, "raster-opacity", opacity);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
