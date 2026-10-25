import { useContext } from "react";
import { DeviceInspectorContext, type DeviceInspectorContextValue } from "./deviceInspectorContextObject";

export function useDeviceInspector(): DeviceInspectorContextValue {
  const ctx = useContext(DeviceInspectorContext);
  if (!ctx) throw new Error("useDeviceInspector must be used within a DeviceInspectorProvider");
  return ctx;
}
