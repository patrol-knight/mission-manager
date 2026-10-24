import type { Anomaly } from "../anomalies/anomalyTypes";

/** On-screen diameter of a single anomaly marker (AnomalyLayer). */
export const SINGLE_SIZE_PX = 20;
/** Markers closer than this (edge to edge) count as overlapping. */
const MIN_GAP_PX = 2;

/** A cluster marker grows with its member count (24 px for two, up to
 * 38 px), so a big pile of anomalies reads as bigger at a glance. */
export function groupSize(count: number): number {
  return count <= 1 ? SINGLE_SIZE_PX : Math.min(38, 24 + 5 * Math.log2(count - 1));
}

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
 * Screen-space grouping so no two markers overlap: anomalies (and the
 * clusters they form) merge while their drawn circles -- which grow with
 * the member count, see groupSize -- would touch, until none do. Groups of
 * one are returned as plain anomalies. Anomalies listed in `keepSingle`
 * (the investigation target, the selected one) are never grouped, so their
 * rings stay visible. Anomalies without a position are dropped. Quadratic
 * per merge, fine for the few dozen anomalies on a site.
 */
export function groupAnomalies(
  anomalies: Anomaly[],
  project: (lon: number, lat: number) => ScreenPoint,
  keepSingle: ReadonlySet<string>,
): { singles: Anomaly[]; groups: AnomalyGroup[] } {
  const singles: Anomaly[] = [];
  const pending: { center: ScreenPoint; members: Anomaly[] }[] = [];

  for (const anomaly of anomalies) {
    if (anomaly.lat == null || anomaly.lon == null) continue;
    if (keepSingle.has(anomaly.anomalyId)) {
      singles.push(anomaly);
      continue;
    }
    pending.push({ center: project(anomaly.lon, anomaly.lat), members: [anomaly] });
  }

  const overlap = (a: (typeof pending)[number], b: (typeof pending)[number]) =>
    Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) <
    (groupSize(a.members.length) + groupSize(b.members.length)) / 2 + MIN_GAP_PX;

  // Merge the first overlapping pair until there is none. A merged cluster
  // is bigger and sits at its members' mean, so it can reach new neighbours:
  // hence the restart rather than a single pass.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pending.length && !merged; i++) {
      for (let j = i + 1; j < pending.length; j++) {
        if (!overlap(pending[i], pending[j])) continue;
        const a = pending[i];
        const b = pending[j];
        const n = a.members.length + b.members.length;
        a.center = {
          x: (a.center.x * a.members.length + b.center.x * b.members.length) / n,
          y: (a.center.y * a.members.length + b.center.y * b.members.length) / n,
        };
        a.members.push(...b.members);
        pending.splice(j, 1);
        merged = true;
        break;
      }
    }
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

/**
 * Takes out of `singles` and `groups` every marker the investigated
 * anomaly's marker (`target`) would overlap, returning their anomalies as
 * `hidden` -- they are counted on their tower's marker instead, so the
 * yellow marker never sits on a pile of red ones. `keepVisible` (the
 * selected anomaly) is never hidden.
 */
export function hideUnderTarget(
  singles: Anomaly[],
  groups: AnomalyGroup[],
  target: Anomaly | null,
  project: (lon: number, lat: number) => ScreenPoint,
  keepVisible: ReadonlySet<string>,
): { singles: Anomaly[]; groups: AnomalyGroup[]; hidden: Anomaly[] } {
  if (!target || target.lat == null || target.lon == null) return { singles, groups, hidden: [] };
  const at = project(target.lon, target.lat);
  const covered = (lon: number, lat: number, size: number) => {
    const p = project(lon, lat);
    return Math.hypot(p.x - at.x, p.y - at.y) < (SINGLE_SIZE_PX + size) / 2 + MIN_GAP_PX;
  };

  const hidden: Anomaly[] = [];
  const keptSingles = singles.filter((a) => {
    if (a.anomalyId === target.anomalyId || keepVisible.has(a.anomalyId)) return true;
    if (!covered(a.lon as number, a.lat as number, SINGLE_SIZE_PX)) return true;
    hidden.push(a);
    return false;
  });
  const keptGroups = groups.filter((g) => {
    if (!covered(g.lon, g.lat, groupSize(g.members.length))) return true;
    hidden.push(...g.members);
    return false;
  });
  return { singles: keptSingles, groups: keptGroups, hidden };
}
