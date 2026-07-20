import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { useDeviceStore, selectDeviceList } from "../../stores/deviceStore";
import { useDeviceInspector } from "./useDeviceInspector";
import { xyToLngLat } from "../../api/mapApi";
import type { Device } from "../../types/domain";

const DEVICE_COLORS: Record<Device["type"], string> = {
  robot: "#1a73e8",
  iot: "#d6336c",
};

function buildDeviceElement(device: Device): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:26px;height:26px;border-radius:50%;
    background:${DEVICE_COLORS[device.type]};
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    cursor:pointer;
  `;
  el.title = device.name ?? device.deviceId;
  return el;
}

export function DeviceMarkerLayer() {
  const { map } = useContext(MapContext);
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const { openInspector } = useDeviceInspector();

  const options = useMemo<UseMarkerListOptions<Device>>(
    () => ({
      keyOf: (d) => d.deviceId,
      project: async (d) => {
        try {
          const { lat, lon } = await xyToLngLat(d.pose.x, d.pose.y, d.pose.frameId);
          return { lng: lon, lat };
        } catch {
          return null;
        }
      },
      buildElement: buildDeviceElement,
      onClick: (d) => openInspector(d.deviceId),
    }),
    [openInspector],
  );

  useMarkerList(map, devices, options);
  return null;
}
