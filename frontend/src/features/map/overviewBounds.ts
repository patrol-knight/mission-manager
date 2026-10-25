import type { Device } from "../../types/domain";

/** [[west, south], [east, north]] in lng/lat, as maplibre's fitBounds takes it. */
export type LngLatBoundsLike = [[number, number], [number, number]];

/** Anomalies are reported 5-8 m in front of a tower's fixed camera, so this
 * margin around every device keeps them in view without tracking them. */
export const DEVICE_MARGIN_M = 10;

const METERS_PER_DEGREE_LAT = 111_320;

/**
 * The whole map plus a DEVICE_MARGIN_M box around every device -- an IoT
 * tower can stand at the map's edge, and its position is fixed, so it counts
 * even while disconnected. Null when there is nothing at all to fit.
 */
export function overviewBounds(
  mapBounds: LngLatBoundsLike | null,
  devices: Device[],
  marginM = DEVICE_MARGIN_M,
): LngLatBoundsLike | null {
  const points: [number, number][] = mapBounds ? [...mapBounds] : [];
  for (const d of devices) {
    const { lat, lon } = d.pose;
    if (lat == null || lon == null) continue;
    const dLat = marginM / METERS_PER_DEGREE_LAT;
    const dLon = marginM / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
    points.push([lon - dLon, lat - dLat], [lon + dLon, lat + dLat]);
  }
  if (points.length === 0) return null;

  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
