import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useDeviceInspector } from "./useDeviceInspector";
import { useApiConnection } from "../../hooks/useApiConnection";
import { connectivityStatus, type Device } from "../../types/domain";

const DEVICE_COLORS: Record<Device["type"], string> = {
  robot: "#1a73e8",
  iot: "#d6336c",
};

// Dim + desaturate on disconnect rather than removing the marker (last-known
// position stays useful) or changing its base color (that's the type legend).
// backendConnected false means each device's own `connected` field is stale
// (no websocket to refresh it) -- dims exactly the same as a real per-device
// disconnect, since the map marker has no separate color channel for "we
// can't tell" the way DeviceConnectivityPanel's status dot does.
function applyConnectivityStyle(el: HTMLElement, device: Device, backendConnected: boolean): void {
  const connected = backendConnected && connectivityStatus(device) === "connected";
  el.style.opacity = connected ? "1" : "0.45";
  el.style.filter = connected ? "none" : "grayscale(1)";
  const name = device.name ?? device.deviceId;
  el.title = !backendConnected ? `${name} (backend disconnected)` : connected ? name : `${name} (disconnected)`;
}

function buildDeviceElement(device: Device, backendConnected: boolean): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:26px;height:26px;border-radius:50%;
    background:${DEVICE_COLORS[device.type]};
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    cursor:pointer;
    z-index:10;
  `;
  // Explicit z-index, not just mounting DeviceMarkerLayer last -- markers
  // are appended to the DOM as each layer's own useMarkerList effect
  // resolves, not in JSX/mount order, so relying on mount order to decide
  // stacking is fragile. Device markers need to always win (e.g. the robot
  // driving through a waypoint must stay visible), so this is the reliable
  // way to guarantee it regardless of resolution order.
  applyConnectivityStyle(el, device, backendConnected);
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
      // lat/lon are computed once, server-side, at Zenoh ingest time (see
      // backend/models/device.py::Pose2D) -- no xy-to-lnglat call needed
      // here at all anymore, which is what made this the single biggest
      // source of per-tick network traffic while the robot is moving.
      project: async (d) => (d.pose.lat != null && d.pose.lon != null ? { lng: d.pose.lon, lat: d.pose.lat } : null),
      buildElement: (d) => buildDeviceElement(d, backendConnected),
      updateElement: (el, d) => applyConnectivityStyle(el, d, backendConnected),
      onClick: (d) => openInspector(d.deviceId),
    }),
    [openInspector, backendConnected],
  );

  useMarkerList(map, devices, options, [backendConnected]);
  return null;
}
