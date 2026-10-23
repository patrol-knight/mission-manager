import { useContext, useEffect, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { fovSector } from "./geo";
import { mapPalette } from "./mapPalette";

/** Assumed camera coverage of a tower -- the backend doesn't report it yet.
 * Anomalies are reported within ~5 m of the tower that saw them. */
const TOWER_FOV_DEG = 90;
const TOWER_RANGE_M = 6;

const SOURCE_ID = "tower-fov";
const FILL_ID = "tower-fov-fill";
const LINE_ID = "tower-fov-line";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Where each IoT tower's camera looks: a faint sector in front of it, so an
 * anomaly reads as "seen by that tower" at a glance. */
export function TowerFovLayer() {
  const { map } = useContext(MapContext);
  const devices = useDeviceStore(useShallow(selectDeviceList));

  const sectors = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: devices
        .filter((d) => d.type === "iot" && d.pose.lat != null && d.pose.lon != null)
        .map((d) => ({
          type: "Feature" as const,
          properties: { deviceId: d.deviceId },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              fovSector(d.pose.lon as number, d.pose.lat as number, d.pose.yaw, (TOWER_FOV_DEG * Math.PI) / 180, TOWER_RANGE_M),
            ],
          },
        })),
    }),
    [devices],
  );

  useEffect(() => {
    if (!map) return;
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY });
      map.addLayer({ id: FILL_ID, type: "fill", source: SOURCE_ID, paint: { "fill-color": mapPalette.fovFill } });
      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SOURCE_ID,
        paint: { "line-color": mapPalette.fovLine, "line-width": 1, "line-dasharray": [2, 2] },
      });
    }
    return () => {
      [LINE_ID, FILL_ID].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  useEffect(() => {
    (map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(sectors);
  }, [map, sectors]);

  return null;
}
