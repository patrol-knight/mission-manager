import { useCallback, useContext, useMemo } from "react";
import * as maplibregl from "maplibre-gl";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useDeviceInspector } from "./useDeviceInspector";
import { useApiConnection } from "../../hooks/useApiConnection";
import type { Device } from "../../types/domain";
import { mapPalette } from "../map/mapPalette";
import { useMapHighlightStore } from "../../stores/mapHighlightStore";
import { useInvestigationStore } from "../../stores/investigationStore";
import { setMarkerGlyph } from "../map/markerGlyph";

/** Zoom a badge click goes to first (as for anomaly clusters). */
const COMFORT_ZOOM = 21;
/** A tower carrying a badge: above anomalies (5, 6), under the investigated
 * one (8). */
const DEVICE_Z_INDEX_WITH_BADGE = 7;
import { headingDegrees } from "../map/geo";
import { deviceConnectivity } from "./connectivity";

// Explicit stacking, not mount order -- markers are appended to the DOM as
// each layer's useMarkerList effect resolves, so mount order is fragile.
// Waypoints 1 < IoT 4 < anomalies 5 (AnomalyLayer) < robot 10: anomalies sit
// a meter or two from the tower that saw them, so they must win over the
// tower to stay clickable, and the robot must always stay visible.
const DEVICE_Z_INDEX: Record<Device["type"], number> = {
  robot: 10,
  iot: 4,
};

// Dim + desaturate on disconnect rather than removing the marker (last-known
// position stays useful) or changing its base color (that's the type legend).
// An unknown status (backend unreachable) dims exactly like a real disconnect,
// since a marker has no separate color channel for "we can't tell" the way
// a status pill does.
function applyConnectivityStyle(el: HTMLElement, device: Device, backendConnected: boolean): void {
  const { status } = deviceConnectivity(device, backendConnected);
  const online = status === "online";
  el.style.opacity = online ? "1" : "0.45";
  el.style.filter = online ? "none" : "grayscale(1)";
  const name = device.name ?? device.deviceId;
  // Hover hint (HintLayer): what clicking does, or why it's dimmed.
  el.dataset.hint =
    status === "unknown" ? `${name} · Backend disconnected` : online ? `${name} · Click to view camera` : `${name} · Disconnected`;
  el.setAttribute("aria-label", name);
}

/** An arrow pointing where the robot faces, inside a soft halo. The marker
 * itself is rotated (useMarkerList's rotationOf), so the arrow points up. */
function buildRobotElement(): HTMLElement {
  const color = mapPalette.device.robot;
  const el = document.createElement("div");
  el.style.cssText = `
    width:40px;height:40px;cursor:pointer;z-index:${DEVICE_Z_INDEX.robot};
    transition:width 150ms ease-out, height 150ms ease-out;
  `;
  el.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 40 40" style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35))">
      <circle cx="20" cy="20" r="18" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.5" />
      <path d="M20 6.2 L30 31 L20 25.2 L10 31 Z" fill="${color}" stroke="${mapPalette.markerBorder}"
        stroke-width="2" stroke-linejoin="round" />
    </svg>`;
  return el;
}

/** The robot card is hovered: grow the marker and deepen its halo. */
function applyRobotHighlight(el: HTMLElement, highlighted: boolean): void {
  const size = highlighted ? 50 : 40;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.querySelector("circle")?.setAttribute("fill-opacity", highlighted ? "0.32" : "0.18");
}

/** A plain rounded square: a fixed tower. Its alerts are
 * counted in the towers card, not on the marker, where a badge would collide
 * with the anomaly markers a meter or two away. */
function buildTowerElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position:relative;width:22px;height:22px;border-radius:6px;box-sizing:border-box;
    background:${mapPalette.device.iot};
    border:2px solid ${mapPalette.markerBorder};
    box-shadow:${mapPalette.markerShadow};
    cursor:pointer;
    transition:width 150ms ease-out, height 150ms ease-out, box-shadow 150ms ease-out;
    z-index:${DEVICE_Z_INDEX.iot};
  `;
  return el;
}

/** The tower's row is hovered in the towers list: grow and ring it, so it
 * can be found on the map even when anomalies crowd it. */
function applyTowerHighlight(el: HTMLElement, highlighted: boolean): void {
  const size = highlighted ? 28 : 22;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.boxShadow = highlighted
    ? `0 0 0 6px ${mapPalette.towerHalo}, ${mapPalette.markerShadow}`
    : mapPalette.markerShadow;
}

/** Which corner of a tower faces away from the investigated anomaly --
 * screen y grows downward. Top right when there's no target. */
function cornerAwayFrom(tower: Device, target: { lat: number | null; lon: number | null } | undefined): { x: "left" | "right"; y: "top" | "bottom" } {
  if (!target || target.lat == null || target.lon == null || tower.pose.lat == null || tower.pose.lon == null) {
    return { x: "right", y: "top" };
  }
  return {
    x: tower.pose.lon >= target.lon ? "right" : "left",
    y: tower.pose.lat >= target.lat ? "top" : "bottom",
  };
}

/** A red count on the tower's corner for its anomalies hidden under the
 * investigated one's marker (see hideUnderTarget), on the corner facing away
 * from it so the yellow marker doesn't cover it. Part of the tower's marker,
 * so it moves and grows with it. Clicking it zooms in until they separate;
 * its ids are read at click time. */
function applyHiddenBadge(
  el: HTMLElement,
  ids: string[],
  corner: { x: "left" | "right"; y: "top" | "bottom" },
  onZoom: (ids: string[]) => void,
): void {
  let badge = el.querySelector<HTMLElement>(":scope > .tower-badge");
  if (ids.length === 0) {
    badge?.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "tower-badge";
    badge.style.cssText = `
      position:absolute;
      min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;
      display:flex;align-items:center;justify-content:center;
      background:${mapPalette.anomaly};border:1.5px solid ${mapPalette.markerBorder};
      box-shadow:${mapPalette.markerShadow};
      color:${mapPalette.markerText};font:700 10px system-ui,sans-serif;
      cursor:zoom-in;
    `;
    badge.addEventListener("click", (e) => {
      // Not the tower's own click (which opens its camera).
      e.stopPropagation();
      onZoom((badge as HTMLElement).dataset.ids?.split(",") ?? []);
    });
    el.appendChild(badge);
  }
  // Centred on the corner: half the badge outside the tower.
  badge.style.top = corner.y === "top" ? "-9px" : "auto";
  badge.style.bottom = corner.y === "bottom" ? "-9px" : "auto";
  badge.style.left = corner.x === "left" ? "-9px" : "auto";
  badge.style.right = corner.x === "right" ? "-9px" : "auto";
  badge.dataset.ids = ids.join(",");
  badge.dataset.hint = `${ids.length} more ${ids.length === 1 ? "anomaly" : "anomalies"} here · Click to zoom in`;
  setMarkerGlyph(badge, String(ids.length));
}

export function DeviceMarkerLayer() {
  const { map } = useContext(MapContext);
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const { openInspector } = useDeviceInspector();
  const { status: wsStatus } = useApiConnection();
  const backendConnected = wsStatus === "connected";
  const hoveredDeviceId = useMapHighlightStore((s) => s.hoveredDeviceId);
  const hiddenByTower = useMapHighlightStore((s) => s.hiddenByTower);
  const targetId = useInvestigationStore((s) => s.investigation?.anomalyId ?? null);
  const target = useDeviceStore((s) => (targetId ? s.anomalies[targetId] : undefined));

  // Fit the hidden anomalies (and the investigated one they sit under) far
  // enough in that they come out from under it.
  const zoomToHidden = useCallback(
    (ids: string[]) => {
      if (!map) return;
      const { anomalies } = useDeviceStore.getState();
      const bounds = new maplibregl.LngLatBounds();
      for (const id of [...ids, targetId]) {
        const a = id ? anomalies[id] : undefined;
        if (a?.lat != null && a.lon != null) bounds.extend([a.lon, a.lat]);
      }
      if (bounds.isEmpty()) return;
      const maxZoom = map.getZoom() < COMFORT_ZOOM - 0.5 ? COMFORT_ZOOM : map.getMaxZoom();
      map.fitBounds(bounds, { padding: 160, maxZoom, duration: 600 });
    },
    [map, targetId],
  );

  const options = useMemo<UseMarkerListOptions<Device>>(
    () => ({
      keyOf: (d) => d.deviceId,
      dependsOn: (d) => [d.pose.lat, d.pose.lon],
      // lat/lon are computed server-side at Zenoh ingest (see
      // backend/models/device.py::Pose2D), so no projection call is needed.
      project: async (d) => (d.pose.lat != null && d.pose.lon != null ? { lng: d.pose.lon, lat: d.pose.lat } : null),
      buildElement: (d) => (d.type === "robot" ? buildRobotElement() : buildTowerElement()),
      updateElement: (el, d) => {
        applyConnectivityStyle(el, d, backendConnected);
        if (d.type === "robot") {
          applyRobotHighlight(el, d.deviceId === hoveredDeviceId);
          return;
        }
        applyTowerHighlight(el, d.deviceId === hoveredDeviceId);
        const hidden = hiddenByTower[d.deviceId] ?? [];
        applyHiddenBadge(el, hidden, cornerAwayFrom(d, target), zoomToHidden);
        // With a badge, the tower rises above nearby anomalies (still under
        // the investigated one), so the badge stays clickable.
        el.style.zIndex = String(hidden.length > 0 ? DEVICE_Z_INDEX_WITH_BADGE : DEVICE_Z_INDEX.iot);
      },
      // Towers don't rotate; their facing is drawn by TowerFovLayer.
      rotationOf: (d) => (d.type === "robot" ? headingDegrees(d.pose.yaw) : 0),
      onClick: (d) => openInspector(d.deviceId),
    }),
    [openInspector, backendConnected, hoveredDeviceId, hiddenByTower, target, zoomToHidden],
  );

  useMarkerList(map, devices, options, [backendConnected, hoveredDeviceId, hiddenByTower, target]);
  return null;
}
