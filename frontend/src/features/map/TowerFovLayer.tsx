import { useContext, useEffect, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { fovSector } from "./geo";
import { mapPalette } from "./mapPalette";
import { isLiveTower, towerFov } from "../devices/towers";

const SOURCE_ID = "tower-fov";
const FILL_ID = "tower-fov-fill";
const LINE_ID = "tower-fov-line";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Where each IoT tower's camera looks: a faint sector in front of it, so an
 * anomaly reads as "seen by that tower" at a glance. Only towers that report
 * their coverage (see towerFov) get one. */
export function TowerFovLayer() {
  const { map } = useContext(MapContext);
  const devices = useDeviceStore(useShallow(selectDeviceList));

  const sectors = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: devices.flatMap((d) => {
        const fov = isLiveTower(d) ? towerFov(d) : null;
        if (!fov || d.pose.lat == null || d.pose.lon == null) return [];
        return [
          {
            type: "Feature" as const,
            properties: { deviceId: d.deviceId },
            geometry: {
              type: "Polygon" as const,
              coordinates: [fovSector(d.pose.lon, d.pose.lat, d.pose.yaw, fov.fovRad, fov.rangeM)],
            },
          },
        ];
      }),
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
