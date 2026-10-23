import { useContext, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useDeviceStore, selectAnomalyList } from "../../stores/deviceStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useToast } from "../../components/useToast";
import { useNow, formatAge } from "../../hooks/useNow";
import { needsVerdict } from "../investigation/investigationTypes";
import { groupAnomalies, type AnomalyGroup } from "./anomalyGroups";
import { mapPalette } from "./mapPalette";
import {
  formatAnomalyTypes,
  formatConfidence,
  isClosed,
  type Anomaly,
} from "../anomalies/anomalyTypes";

/** Markers start fading once less than this share of the grace period is left. */
const FADE_FROM = 0.5;
const MIN_OPACITY = 0.3;
/** First zoom level a group click goes to (see groupOptions.onClick). */
const COMFORT_ZOOM = 21;

/** A small red dot with a pulsing halo -- small on purpose: anomalies sit a
 * meter or two from the tower that saw them, and the tower's alert badge and
 * the right panel carry the detail. */
function buildAnomalyElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:14px;height:14px;border-radius:50%;box-sizing:border-box;
    cursor:pointer;
    transition:opacity 1s linear;
    z-index:5;
  `;
  return el;
}

/** Opacity from how much of the grace period is left: full until FADE_FROM,
 * then down to MIN_OPACITY, so the operator sees an anomaly going stale. */
function expiryOpacity(anomaly: Anomaly, now: number): number {
  const left = (Date.parse(anomaly.expiresAt) - now) / (anomaly.degradeSec * 1000);
  if (left >= FADE_FROM) return 1;
  return MIN_OPACITY + (1 - MIN_OPACITY) * Math.max(0, left / FADE_FROM);
}

/** A cluster marker grows with its member count (22 px for two, up to
 * 40 px), so a big pile of anomalies reads as bigger at a glance. */
function groupSize(count: number): number {
  return Math.min(40, 22 + 6 * Math.log2(count - 1));
}

function buildGroupElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    border-radius:50%;box-sizing:border-box;
    background:${mapPalette.anomaly};
    border:2px solid ${mapPalette.markerBorder};
    display:flex;align-items:center;justify-content:center;
    color:${mapPalette.markerText};font:700 11px system-ui,sans-serif;
    cursor:zoom-in;
    transition:opacity 1s linear;
    animation: anomaly-pulse 1.4s ease-out infinite;
    z-index:5;
  `;
  return el;
}

function groupTooltipHtml(group: AnomalyGroup): string {
  const lines = group.members.map((m) => `${formatAnomalyTypes(m.types)} · ${formatConfidence(m.confidence)}`);
  return `<div style="font-size:12px;line-height:1.5"><strong>${group.members.length} anomalies</strong> · click to zoom in<br/>${lines.join("<br/>")}</div>`;
}

function tooltipHtml(anomaly: Anomaly, now: number): string {
  const lines = [
    `<strong>${formatAnomalyTypes(anomaly.types)}</strong>`,
    `Confidence ${formatConfidence(anomaly.confidence)}`,
    `Detected ${formatAge(anomaly.detectedAt, now)} ago`,
  ];
  if (anomaly.resolution === "unclear") lines.push("Last verdict: UNCLEAR");
  return `<div style="font-size:12px;line-height:1.5">${lines.join("<br/>")}</div>`;
}

/** Anomaly markers: hover for a summary, click to open the anomaly card.
 * While the robot is on site without a verdict, clicking another anomaly
 * only explains why it can't be picked yet. Closed anomalies are hidden.
 *
 * Anomalies come from a fixed camera's field of view, so several can sit a
 * few meters apart and overlap on screen. Those are drawn as one marker with
 * a count; clicking it zooms in until they separate (regrouped on every
 * pan/zoom). The investigation target and the selected anomaly are never
 * grouped. */
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

  const { singles, groups } = useMemo(() => {
    if (!map) return { singles: [], groups: [] };
    const keepSingle = new Set([targetId, selectedId].filter((id): id is string => id !== null));
    return groupAnomalies(anomalies, (lon, lat) => map.project([lon, lat]), keepSingle);
    // viewVersion: re-project after the map moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, anomalies, targetId, selectedId, viewVersion]);

  // Hover popup: one instance, fed the latest anomaly data at hover time.
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const latestRef = useRef<Record<string, Anomaly>>({});
  useEffect(() => {
    latestRef.current = Object.fromEntries(anomalies.map((a) => [a.anomalyId, a]));
  }, [anomalies]);

  useEffect(() => {
    if (!map) return;
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
    popupRef.current = popup;
    const clearSelection = () => selectAnomaly(null);
    map.on("click", clearSelection);
    return () => {
      map.off("click", clearSelection);
      popup.remove();
      popupRef.current = null;
    };
  }, [map, selectAnomaly]);

  const options = useMemo<UseMarkerListOptions<Anomaly>>(
    () => ({
      keyOf: (a) => a.anomalyId,
      dependsOn: (a) => [a.lat, a.lon],
      // Computed server-side at ingest (backend/models/anomaly.py::Anomaly.lat/lon).
      project: async (a) => (a.lat != null && a.lon != null ? { lng: a.lon, lat: a.lat } : null),
      buildElement: (a) => {
        const el = buildAnomalyElement();
        el.addEventListener("mouseenter", () => {
          const latest = latestRef.current[a.anomalyId];
          if (!map || !popupRef.current || !latest || latest.lat == null || latest.lon == null) return;
          popupRef.current.setLngLat([latest.lon, latest.lat]).setHTML(tooltipHtml(latest, Date.now())).addTo(map);
        });
        el.addEventListener("mouseleave", () => popupRef.current?.remove());
        return el;
      },
      updateElement: (el, a) => {
        const targeted = a.anomalyId === targetId;
        const selected = a.anomalyId === selectedId;
        // An "unclear" verdict leaves the anomaly open: drawn hollow.
        const unclear = a.resolution === "unclear";
        // The investigated one turns solid yellow and larger, matching its
        // yellow route; the rest stay small red dots.
        const size = targeted ? 22 : 14;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.background = targeted
          ? mapPalette.investigation
          : unclear
            ? mapPalette.markerBorder
            : mapPalette.anomaly;
        const ring = selected ? mapPalette.selectedRing : unclear ? mapPalette.anomaly : mapPalette.markerBorder;
        el.style.border = `${selected || unclear ? 3 : 2}px solid ${ring}`;
        el.style.opacity = targeted ? "1" : String(expiryOpacity(a, now));
        // The investigated anomaly sits on top of its neighbours (only the
        // robot is higher, see DeviceMarkerLayer), then the selected one.
        el.style.zIndex = targeted ? "8" : selected ? "6" : "5";
        el.style.animation = targeted ? "investigation-target-pulse 1.4s ease-out infinite" : "anomaly-pulse 1.4s ease-out infinite";
        el.setAttribute("aria-label", `Anomaly: ${formatAnomalyTypes(a.types)}`);
      },
      onClick: (a) => {
        const investigation = useInvestigationStore.getState().investigation;
        if (needsVerdict(investigation) && a.anomalyId !== investigation?.anomalyId) {
          show("warning", "Please verify the current anomaly first");
          return;
        }
        popupRef.current?.remove();
        selectAnomaly(a.anomalyId);
      },
    }),
    [map, targetId, selectedId, now, selectAnomaly, show],
  );

  const groupOptions = useMemo<UseMarkerListOptions<AnomalyGroup>>(
    () => ({
      keyOf: (g) => g.key,
      dependsOn: (g) => [g.lat, g.lon],
      project: async (g) => ({ lng: g.lon, lat: g.lat }),
      buildElement: (g) => {
        const el = buildGroupElement();
        el.addEventListener("mouseenter", () => {
          if (!map || !popupRef.current) return;
          popupRef.current.setLngLat([g.lon, g.lat]).setHTML(groupTooltipHtml(g)).addTo(map);
        });
        el.addEventListener("mouseleave", () => popupRef.current?.remove());
        return el;
      },
      updateElement: (el, g) => {
        const size = groupSize(g.members.length);
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.fontSize = `${Math.round(size * 0.45)}px`;
        el.textContent = String(g.members.length);
        el.style.opacity = String(Math.max(...g.members.map((m) => expiryOpacity(m, now))));
        el.setAttribute("aria-label", `${g.members.length} anomalies, click to zoom in`);
      },
      onClick: (g) => {
        if (!map) return;
        popupRef.current?.remove();
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
