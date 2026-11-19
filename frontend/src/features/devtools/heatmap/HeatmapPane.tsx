import { useEffect, useRef, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import { heatmapDataUrl } from "../../map/heatmapColormap";
import { LaneletLayer } from "../../map/LaneletLayer";
import { MapContext } from "../../map/MapContext";
import { MapWorkspace } from "../../map/MapWorkspace";
import { useMapInstance } from "../../map/useMapInstance";
import type { HeatmapPreview } from "./heatmapApi";
import styles from "./Heatmap.module.css";

export type ClickMode = "select" | "hotspot" | "demo";

const HEAT_ID = "dev-heat";
const POINTS_ID = "dev-points";
const HOTSPOTS_ID = "dev-hotspots";
// MapLibre paints can't read CSS variables.
const VERDICT_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "verdict"],
  "true_positive",
  "#c51e3a",
  "unclear",
  "#6b7280",
  "false_positive",
  "#16a34a",
  "#b8bcc4",
];
const HOTSPOT_COLOR = "#2563eb";
// Meters per pixel at zoom 0 on the equator, for 512 px tiles.
const M_PER_PX_Z0 = 78271.517;

interface Props {
  header: ReactNode;
  preview: HeatmapPreview | null;
  radii: number[];
  selected: number | null;
  // Where a dragged hotspot was dropped, until the next preview has it.
  moved: { index: number; lngLat: [number, number] } | null;
  opacity: number;
  showPoints: boolean;
  mode: ClickMode;
  onMap: (map: maplibregl.Map | null) => void;
  onClick: (lngLat: maplibregl.LngLat) => void;
  onSelect: (index: number) => void;
  onMove: (index: number, lngLat: maplibregl.LngLat) => void;
}

function hotspotFeatures(
  preview: HeatmapPreview | null,
  radii: number[],
  selected: number | null,
  moved: Props["moved"],
) {
  return (preview?.hotspots ?? []).map((h, i) => ({
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: moved?.index === i ? moved.lngLat : [h.lon, h.lat] },
    properties: {
      index: i,
      selected: i === selected,
      px0: Math.max(radii[i] ?? 3, 1) / (M_PER_PX_Z0 * Math.cos((h.lat * Math.PI) / 180)),
    },
  }));
}

export function HeatmapPane(props: Props) {
  const { header, preview, radii, selected, moved, opacity, showPoints, mode } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useMapInstance(containerRef);
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    handlers.current.onMap(ready ? map : null);
  }, [map, ready]);

  useEffect(() => {
    if (!map || !ready) return;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    map.addSource(POINTS_ID, { type: "geojson", data: empty });
    map.addSource(HOTSPOTS_ID, { type: "geojson", data: empty });
    map.addLayer({
      id: HOTSPOTS_ID,
      type: "circle",
      source: HOTSPOTS_ID,
      paint: {
        "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["get", "px0"], 24, ["*", ["get", "px0"], 2 ** 24]],
        "circle-color": HOTSPOT_COLOR,
        "circle-opacity": ["case", ["get", "selected"], 0.16, 0.06],
        "circle-stroke-color": HOTSPOT_COLOR,
        "circle-stroke-width": ["case", ["get", "selected"], 2.5, 1.2],
      },
    });
    map.addLayer({
      id: POINTS_ID,
      type: "circle",
      source: POINTS_ID,
      paint: {
        "circle-radius": ["case", ["==", ["get", "source"], "demo"], 6, ["interpolate", ["linear"], ["get", "weight"], 0, 2, 1, 5]],
        "circle-color": VERDICT_COLOR,
        "circle-stroke-color": ["match", ["get", "source"], "baseline", "#ffffff", "#111827"],
        "circle-stroke-width": ["match", ["get", "source"], "baseline", 1, 1.6],
        "circle-opacity": 0.9,
      },
    });

    let dragging: number | null = null;
    const down = (e: maplibregl.MapLayerMouseEvent) => {
      if (handlers.current.mode !== "select") return;
      const index = e.features?.[0]?.properties?.index as number | undefined;
      if (index === undefined) return;
      e.preventDefault();
      dragging = index;
      handlers.current.onSelect(index);
      map.getCanvas().style.cursor = "grabbing";
    };
    const move = (e: maplibregl.MapMouseEvent) => {
      if (dragging === null) return;
      const source = map.getSource(HOTSPOTS_ID) as maplibregl.GeoJSONSource;
      const { preview: p, radii: r } = handlers.current;
      const features = hotspotFeatures(p, r, dragging, { index: dragging, lngLat: [e.lngLat.lng, e.lngLat.lat] });
      source.setData({ type: "FeatureCollection", features });
    };
    const up = (e: maplibregl.MapMouseEvent) => {
      if (dragging === null) return;
      handlers.current.onMove(dragging, e.lngLat);
      dragging = null;
      map.getCanvas().style.cursor = "";
    };
    const click = (e: maplibregl.MapMouseEvent) => {
      if (handlers.current.mode !== "select") handlers.current.onClick(e.lngLat);
    };
    const enter = () => {
      if (handlers.current.mode === "select") map.getCanvas().style.cursor = "grab";
    };
    const leave = () => {
      if (dragging === null) map.getCanvas().style.cursor = "";
    };
    map.on("mousedown", HOTSPOTS_ID, down);
    map.on("mouseenter", HOTSPOTS_ID, enter);
    map.on("mouseleave", HOTSPOTS_ID, leave);
    map.on("mousemove", move);
    map.on("mouseup", up);
    map.on("click", click);
    return () => {
      map.off("mousedown", HOTSPOTS_ID, down);
      map.off("mouseenter", HOTSPOTS_ID, enter);
      map.off("mouseleave", HOTSPOTS_ID, leave);
      map.off("mousemove", move);
      map.off("mouseup", up);
      map.off("click", click);
      for (const id of [POINTS_ID, HOTSPOTS_ID, HEAT_ID]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [map, ready]);

  useEffect(() => {
    if (!map || !ready || !map.getSource(POINTS_ID)) return;
    const image = preview?.image;
    if (image) {
      const data = {
        url: heatmapDataUrl(image.width, image.height, image.data),
        coordinates: image.corners as [[number, number], [number, number], [number, number], [number, number]],
      };
      const source = map.getSource(HEAT_ID) as maplibregl.ImageSource | undefined;
      if (source) {
        source.updateImage(data);
        map.setLayoutProperty(HEAT_ID, "visibility", "visible");
      } else {
        map.addSource(HEAT_ID, { type: "image", ...data });
        map.addLayer(
          { id: HEAT_ID, type: "raster", source: HEAT_ID, paint: { "raster-resampling": "linear", "raster-fade-duration": 0 } },
          map.getLayer("ll-left") ? "ll-left" : HOTSPOTS_ID,
        );
      }
    } else if (map.getLayer(HEAT_ID)) {
      map.setLayoutProperty(HEAT_ID, "visibility", "none");
    }
    (map.getSource(POINTS_ID) as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (preview?.points ?? []).map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { verdict: p.verdict, weight: p.weight, source: p.source },
      })),
    });
  }, [map, ready, preview]);

  useEffect(() => {
    const source = map?.getSource(HOTSPOTS_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: hotspotFeatures(preview, radii, selected, moved) });
  }, [map, ready, preview, radii, selected, moved]);

  useEffect(() => {
    if (!map || !ready) return;
    if (map.getLayer(HEAT_ID)) map.setPaintProperty(HEAT_ID, "raster-opacity", opacity);
    map.setLayoutProperty(POINTS_ID, "visibility", showPoints ? "visible" : "none");
    map.getCanvas().style.cursor = mode === "select" ? "" : "crosshair";
  }, [map, ready, preview, opacity, showPoints, mode]);

  return (
    <div className={styles.mapBox}>
      <MapContext.Provider value={{ map, ready }}>
        <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
          <LaneletLayer />
        </MapWorkspace>
      </MapContext.Provider>
      <div className={styles.badge}>{header}</div>
    </div>
  );
}
