import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useDeviceInspector } from "./useDeviceInspector";
import { useApiConnection } from "../../hooks/useApiConnection";
import type { Device } from "../../types/domain";
import { mapPalette } from "../map/mapPalette";
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
  el.title = status === "unknown" ? `${name} (backend disconnected)` : online ? name : `${name} (disconnected)`;
}

/** An arrow pointing where the robot faces, inside a soft halo. The marker
 * itself is rotated (useMarkerList's rotationOf), so the arrow points up. */
function buildRobotElement(): HTMLElement {
  const color = mapPalette.device.robot;
  const el = document.createElement("div");
  el.style.cssText = `width:40px;height:40px;cursor:pointer;z-index:${DEVICE_Z_INDEX.robot};`;
  el.innerHTML = `
    <svg width="40" height="40" viewBox="0 0 40 40" style="display:block;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.35))">
      <circle cx="20" cy="20" r="18" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-opacity="0.5" />
      <path d="M20 6.2 L30 31 L20 25.2 L10 31 Z" fill="${color}" stroke="${mapPalette.markerBorder}"
        stroke-width="2" stroke-linejoin="round" />
    </svg>`;
  return el;
}

/** A rounded square: a fixed tower. Its alerts are counted in the towers
 * card, not on the marker, where a badge would collide with the anomaly
 * markers a meter or two away. */
function buildTowerElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    position:relative;width:20px;height:20px;border-radius:6px;
    background:${mapPalette.device.iot};
    border:2px solid ${mapPalette.markerBorder};
    box-shadow:${mapPalette.markerShadow};
    cursor:pointer;
    z-index:${DEVICE_Z_INDEX.iot};
  `;
  return el;
}

export function DeviceMarkerLayer() {
  const { map } = useContext(MapContext);
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const { openInspector } = useDeviceInspector();
  const { status: wsStatus } = useApiConnection();
  const backendConnected = wsStatus === "connected";

  const options = useMemo<UseMarkerListOptions<Device>>(
    () => ({
      keyOf: (d) => d.deviceId,
      dependsOn: (d) => [d.pose.lat, d.pose.lon],
      // lat/lon are computed server-side at Zenoh ingest (see
      // backend/models/device.py::Pose2D), so no projection call is needed.
      project: async (d) => (d.pose.lat != null && d.pose.lon != null ? { lng: d.pose.lon, lat: d.pose.lat } : null),
      buildElement: (d) => (d.type === "robot" ? buildRobotElement() : buildTowerElement()),
      updateElement: (el, d) => applyConnectivityStyle(el, d, backendConnected),
      // Towers don't rotate; their facing is drawn by TowerFovLayer.
      rotationOf: (d) => (d.type === "robot" ? headingDegrees(d.pose.yaw) : 0),
      onClick: (d) => openInspector(d.deviceId),
    }),
    [openInspector, backendConnected],
  );

  useMarkerList(map, devices, options, [backendConnected]);
  return null;
}
