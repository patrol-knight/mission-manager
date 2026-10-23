/** Small map-frame geometry helpers. The local map frame is ENU: x east,
 * y north, yaw counter-clockwise from +x in radians. */

const METERS_PER_DEGREE_LAT = 111_320;

/** A heading in clockwise degrees from north, as MapLibre rotates markers. */
export function headingDegrees(yaw: number): number {
  return 90 - (yaw * 180) / Math.PI;
}

/** The point `distanceM` meters from (lon, lat) in map-frame direction
 * `angle` (radians CCW from east). Flat-earth approximation -- exact enough
 * over the few meters a camera sees. */
export function offsetLngLat(lon: number, lat: number, angle: number, distanceM: number): [number, number] {
  const dx = Math.cos(angle) * distanceM;
  const dy = Math.sin(angle) * distanceM;
  return [lon + dx / (METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180)), lat + dy / METERS_PER_DEGREE_LAT];
}

/** Closed polygon ring for a camera's field of view: a circular sector
 * centred on `yaw`, `fovRad` wide and `rangeM` deep. */
export function fovSector(
  lon: number,
  lat: number,
  yaw: number,
  fovRad: number,
  rangeM: number,
  steps = 16,
): [number, number][] {
  const ring: [number, number][] = [[lon, lat]];
  for (let i = 0; i <= steps; i++) {
    const angle = yaw - fovRad / 2 + (fovRad * i) / steps;
    ring.push(offsetLngLat(lon, lat, angle, rangeM));
  }
  ring.push([lon, lat]);
  return ring;
}

type LngLatPair = [number, number];

/**
 * What is left of `route` (a [lng, lat] polyline) for a vehicle at
 * `position`: the closest point on the route, then every vertex after it --
 * the "remaining path" a navigation app draws, shrinking as the vehicle
 * drives. Ties go to the earlier segment, so where a route passes the same
 * spot twice, the vehicle is placed on its first pass. Pure: no API call,
 * cheap enough to rerun on every position update.
 */
export function remainingRoute(route: LngLatPair[], position: LngLatPair): LngLatPair[] {
  if (route.length < 2) return route;
  // Flatten around the vehicle: longitude degrees shrink with latitude.
  const k = Math.cos((position[1] * Math.PI) / 180);
  const px = position[0] * k;
  const py = position[1];

  let best = { distance: Infinity, segment: 0, point: route[0] };
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = [route[i][0] * k, route[i][1]];
    const [bx, by] = [route[i + 1][0] * k, route[i + 1][1]];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const distance = (px - cx) ** 2 + (py - cy) ** 2;
    if (distance < best.distance) best = { distance, segment: i, point: [cx / k, cy] };
  }
  return [best.point, ...route.slice(best.segment + 1)];
}
