import type { Anomaly } from "../anomalies/anomalyTypes";

/** Markers are 22 px wide; closer than this they overlap enough to be hard to click. */
export const GROUP_RADIUS_PX = 28;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface AnomalyGroup {
  /** Stable for a given membership, so its map marker survives re-grouping. */
  key: string;
  members: Anomaly[];
  lat: number;
  lon: number;
}

/**
 * Greedy screen-space grouping: each anomaly joins the first group whose
 * centre is within `radiusPx` on screen, otherwise starts a new one. Groups
 * of one are returned as plain anomalies. Anomalies listed in `keepSingle`
 * (the investigation target, the selected one) are never grouped, so their
 * rings stay visible. Anomalies without a position are dropped.
 */
export function groupAnomalies(
  anomalies: Anomaly[],
  project: (lon: number, lat: number) => ScreenPoint,
  keepSingle: ReadonlySet<string>,
  radiusPx = GROUP_RADIUS_PX,
): { singles: Anomaly[]; groups: AnomalyGroup[] } {
  const singles: Anomaly[] = [];
  const pending: { center: ScreenPoint; members: Anomaly[] }[] = [];

  for (const anomaly of anomalies) {
    if (anomaly.lat == null || anomaly.lon == null) continue;
    if (keepSingle.has(anomaly.anomalyId)) {
      singles.push(anomaly);
      continue;
    }
    const point = project(anomaly.lon, anomaly.lat);
    const near = pending.find((g) => Math.hypot(g.center.x - point.x, g.center.y - point.y) <= radiusPx);
    if (!near) {
      pending.push({ center: point, members: [anomaly] });
      continue;
    }
    const n = near.members.length;
    near.center = { x: (near.center.x * n + point.x) / (n + 1), y: (near.center.y * n + point.y) / (n + 1) };
    near.members.push(anomaly);
  }

  const groups: AnomalyGroup[] = [];
  for (const { members } of pending) {
    if (members.length === 1) {
      singles.push(members[0]);
      continue;
    }
    groups.push({
      key: members
        .map((m) => m.anomalyId)
        .sort()
        .join("|"),
      members,
      lat: members.reduce((sum, m) => sum + (m.lat as number), 0) / members.length,
      lon: members.reduce((sum, m) => sum + (m.lon as number), 0) / members.length,
    });
  }
  return { singles, groups };
}
