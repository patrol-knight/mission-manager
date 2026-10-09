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
import {
  formatAnomalyTypes,
  formatConfidence,
  isClosed,
  type Anomaly,
  type AnomalyType,
} from "../anomalies/anomalyTypes";

const TYPE_COLORS: Record<AnomalyType, string> = {
  lying_down: "#e03131",
  loitering: "#f08c00",
  trespassing: "#7048e8",
};
const TARGET_RING = "#FFD700";
const SELECTED_RING = "#1c7ed6";
/** Markers start fading once less than this share of the grace period is left. */
const FADE_FROM = 0.5;
const MIN_OPACITY = 0.3;
/** First zoom level a group click goes to (see groupOptions.onClick). */
const COMFORT_ZOOM = 21;

function buildAnomalyElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:22px;height:22px;border-radius:50%;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    color:white;font-size:12px;font-weight:bold;
    cursor:pointer;
    transition:opacity 1s linear;
    z-index:5;
  `;
  el.textContent = "!";
  return el;
}

/** Opacity from how much of the grace period is left: full until FADE_FROM,
 * then down to MIN_OPACITY, so the operator sees an anomaly going stale. */
function expiryOpacity(anomaly: Anomaly, now: number): number {
  const left = (Date.parse(anomaly.expiresAt) - now) / (anomaly.degradeSec * 1000);
  if (left >= FADE_FROM) return 1;
  return MIN_OPACITY + (1 - MIN_OPACITY) * Math.max(0, left / FADE_FROM);
}

function buildGroupElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:28px;height:28px;border-radius:50%;
    background:#c92a2a;
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    color:white;font-size:13px;font-weight:bold;
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
        el.style.background = TYPE_COLORS[a.types[0]] ?? TYPE_COLORS.lying_down;
        el.style.border = `${targeted || selected ? 3 : 2}px solid ${targeted ? TARGET_RING : selected ? SELECTED_RING : "white"}`;
        el.style.opacity = targeted ? "1" : String(expiryOpacity(a, now));
        el.style.animation = targeted ? "investigation-target-pulse 1.4s ease-out infinite" : "anomaly-pulse 1.4s ease-out infinite";
        el.textContent = a.resolution === "unclear" ? "?" : "!";
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
