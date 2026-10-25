import { useContext, useEffect, useMemo, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useDeviceStore, selectAnomalyList } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { useNow } from "../../hooks/useNow";
import { needsVerdict } from "../investigation/investigationTypes";
import { groupAnomalies, groupSize, hideUnderTarget, SINGLE_SIZE_PX, type AnomalyGroup } from "./anomalyGroups";
import { useMapHighlightStore } from "../../stores/mapHighlightStore";
import { mapPalette } from "./mapPalette";
import { formatAnomalyTypes, isClosed, type Anomaly } from "../anomalies/anomalyTypes";
import { setMarkerGlyph } from "./markerGlyph";

/** Below this share of the grace period left, an anomaly starts fading (and
 * a group stops pulsing): nothing has re-reported it for a while. */
const STALE_FROM = 0.5;
const MIN_OPACITY = 0.45;
/** First zoom level a group click goes to (see groupOptions.onClick). */
const COMFORT_ZOOM = 21;

const SIZE = SINGLE_SIZE_PX;
/** The selected anomaly; the investigated one stays at SIZE (its color and
 * pulse already single it out). */
const SIZE_SELECTED = 26;

/** A red disc with an "!", a thin white gap, then a countdown ring: red
 * while time is left, emptying clockwise to white as the anomaly's grace
 * period runs out -- so the operator sees how stale it is without a number
 * on the map. */
function buildAnomalyElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    border-radius:50%;box-sizing:border-box;padding:3px;
    box-shadow:${mapPalette.markerShadow};
    cursor:pointer;
    transition:opacity 1s linear, width 150ms ease-out, height 150ms ease-out;
    z-index:5;
  `;
  const core = document.createElement("div");
  core.style.cssText = `
    width:100%;height:100%;border-radius:50%;
    box-shadow:0 0 0 1px ${mapPalette.markerBorder};
    display:flex;align-items:center;justify-content:center;
    font:800 13px/1 system-ui,sans-serif;
    pointer-events:none;
  `;
  el.appendChild(core);
  return el;
}

/** Share of the grace period left, 0..1. */
function lifeLeft(anomaly: Anomaly, now: number): number {
  const left = (Date.parse(anomaly.expiresAt) - now) / (anomaly.degradeSec * 1000);
  return Math.min(1, Math.max(0, left));
}

/** Full until STALE_FROM, then down to MIN_OPACITY as it runs out. */
function expiryOpacity(anomaly: Anomaly, now: number): number {
  const left = lifeLeft(anomaly, now);
  if (left >= STALE_FROM) return 1;
  return MIN_OPACITY + (1 - MIN_OPACITY) * (left / STALE_FROM);
}

function buildGroupElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    border-radius:50%;box-sizing:border-box;
    background:${mapPalette.anomaly};
    border:2px solid ${mapPalette.markerBorder};
    display:flex;align-items:center;justify-content:center;
    color:${mapPalette.markerText};font:800 12px system-ui,sans-serif;
    cursor:zoom-in;
    transition:opacity 1s linear;
    z-index:5;
  `;
  return el;
}

/** Anomaly markers: hover for a one-line hint (HintLayer), click
 * to open the anomaly card -- the one place its details are shown.
 * While the robot is on site without a verdict, clicking another anomaly
 * only explains why it can't be picked yet. Closed anomalies are hidden.
 *
 * Anomalies come from a fixed camera's field of view, so several can sit a
 * few meters apart and overlap on screen. Those are drawn as one marker with
 * a count; clicking it zooms in until they separate (regrouped on every
 * pan/zoom). The investigation target and the selected anomaly are never
 * grouped; markers the target would cover are left out and counted on
 * their tower's marker (see hideUnderTarget, DeviceMarkerLayer). */
export function AnomalyLayer() {
  const { map } = useContext(MapContext);
  const anomalies = useDeviceStore(useShallow((s) => selectAnomalyList(s).filter((a) => !isClosed(a))));
  const targetId = useInvestigationStore((s) => s.investigation?.anomalyId ?? null);
  const selectedId = useInvestigationStore((s) => s.selectedAnomalyId);
  const selectAnomaly = useInvestigationStore((s) => s.selectAnomaly);
  const { show } = useToast();
  const now = useNow();

  // Bumped after every pan/zoom, so grouping follows the on-screen distances.
  const [viewVersion, setViewVersion] = useState(0);
  useEffect(() => {
    if (!map) return;
    const regroup = () => setViewVersion((v) => v + 1);
    map.on("moveend", regroup);
    return () => {
      map.off("moveend", regroup);
    };
  }, [map]);

  const { singles, groups, hidden } = useMemo(() => {
    if (!map) return { singles: [], groups: [], hidden: [] };
    const project = (lon: number, lat: number) => map.project([lon, lat]);
    const keepSingle = new Set([targetId, selectedId].filter((id): id is string => id !== null));
    const grouped = groupAnomalies(anomalies, project, keepSingle);
    const target = anomalies.find((a) => a.anomalyId === targetId) ?? null;
    return hideUnderTarget(grouped.singles, grouped.groups, target, project, new Set(selectedId ? [selectedId] : []));
    // viewVersion: re-project after the map moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, anomalies, targetId, selectedId, viewVersion]);

  // Anomalies under the investigated one are counted on their tower instead.
  const setHiddenByTower = useMapHighlightStore((s) => s.setHiddenByTower);
  useEffect(() => {
    const byTower: Record<string, string[]> = {};
    for (const a of hidden) (byTower[a.sourceDeviceId] ??= []).push(a.anomalyId);
    setHiddenByTower(byTower);
  }, [hidden, setHiddenByTower]);
  useEffect(() => () => setHiddenByTower({}), [setHiddenByTower]);

  useEffect(() => {
    if (!map) return;
    const clearSelection = () => selectAnomaly(null);
    map.on("click", clearSelection);
    return () => {
      map.off("click", clearSelection);
    };
  }, [map, selectAnomaly]);

  const options = useMemo<UseMarkerListOptions<Anomaly>>(
    () => ({
      keyOf: (a) => a.anomalyId,
      dependsOn: (a) => [a.lat, a.lon],
      // Computed server-side at ingest (backend/models/anomaly.py::Anomaly.lat/lon).
      project: async (a) => (a.lat != null && a.lon != null ? { lng: a.lon, lat: a.lat } : null),
      buildElement: buildAnomalyElement,
      updateElement: (el, a) => {
        const targeted = a.anomalyId === targetId;
        const selected = a.anomalyId === selectedId;
        // An "unclear" verdict leaves the anomaly open: a white disc with a
        // red "?" instead of the "!".
        const unclear = a.resolution === "unclear";
        const life = targeted ? 1 : lifeLeft(a, now);
        const size = selected && !targeted ? SIZE_SELECTED : SIZE;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        // The investigated one: a plain white rim (it doesn't expire), a
        // yellow disc matching its route, a white "!".
        el.style.background = targeted
          ? mapPalette.markerBorder
          : `conic-gradient(${mapPalette.anomaly} ${life * 360}deg, ${mapPalette.anomalyLifeTrack} 0)`;

        const core = el.firstElementChild as HTMLElement;
        core.style.background = targeted ? mapPalette.investigation : unclear ? mapPalette.markerBorder : mapPalette.anomaly;
        core.style.color = unclear && !targeted ? mapPalette.anomaly : mapPalette.markerText;
        core.style.textShadow = targeted ? "0 0 2px rgba(120,90,0,0.6)" : "none";
        core.style.fontSize = `${size >= SIZE_SELECTED ? 14 : 11}px`;
        setMarkerGlyph(core, unclear && !targeted ? "?" : "!");

        el.style.opacity = targeted ? "1" : String(expiryOpacity(a, now));
        // The investigated anomaly sits on top of its neighbours (only the
        // robot is higher, see DeviceMarkerLayer), then the selected one.
        el.style.zIndex = targeted ? "8" : selected ? "6" : "5";
        // Single anomalies stay still (the countdown ring is their motion);
        // only the investigated one pulses, in yellow.
        el.style.animation = targeted ? "investigation-target-pulse 1.4s ease-out infinite" : "none";
        el.setAttribute("aria-label", `Anomaly: ${formatAnomalyTypes(a.types)}`);
        el.dataset.hint = targeted ? `${formatAnomalyTypes(a.types)} · Investigating` : `${formatAnomalyTypes(a.types)} · Click for details`;
      },
      onClick: (a) => {
        const investigation = useInvestigationStore.getState().investigation;
        if (needsVerdict(investigation) && a.anomalyId !== investigation?.anomalyId) {
          show("warning", "Please verify the current anomaly first");
          return;
        }
        selectAnomaly(a.anomalyId);
      },
    }),
    [targetId, selectedId, now, selectAnomaly, show],
  );

  const groupOptions = useMemo<UseMarkerListOptions<AnomalyGroup>>(
    () => ({
      keyOf: (g) => g.key,
      dependsOn: (g) => [g.lat, g.lon],
      project: async (g) => ({ lng: g.lon, lat: g.lat }),
      buildElement: buildGroupElement,
      updateElement: (el, g) => {
        const size = groupSize(g.members.length);
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.fontSize = `${Math.round(size * 0.42)}px`;
        setMarkerGlyph(el, String(g.members.length));
        // A group fades and stops pulsing only once all its members are stale.
        const freshest = Math.max(...g.members.map((m) => lifeLeft(m, now)));
        el.style.opacity = String(Math.max(...g.members.map((m) => expiryOpacity(m, now))));
        el.style.animation = freshest < STALE_FROM ? "none" : "anomaly-pulse 1.4s ease-out infinite";
        el.setAttribute("aria-label", `${g.members.length} anomalies, click to zoom in`);
        el.dataset.hint = `${g.members.length} anomalies · Click to zoom in`;
      },
      onClick: (g) => {
        if (!map) return;
        const bounds = new maplibregl.LngLatBounds();
        g.members.forEach((m) => bounds.extend([m.lon as number, m.lat as number]));
        // Zoom 21 (~32 px/m at this latitude) separates anomalies more than
        // about a meter apart while keeping the surroundings in view; anything
        // still grouped there is closer than that, so a second click goes all
        // the way in.
        const maxZoom = map.getZoom() < COMFORT_ZOOM - 0.5 ? COMFORT_ZOOM : map.getMaxZoom();
        map.fitBounds(bounds, { padding: 160, maxZoom, duration: 600 });
      },
    }),
    [map, now],
  );

  useMarkerList(map, singles, options, [targetId, selectedId, now]);
  useMarkerList(map, groups, groupOptions, [now]);
  return null;
}
