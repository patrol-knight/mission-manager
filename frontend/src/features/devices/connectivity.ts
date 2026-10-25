import type { DotStatus } from "../../components/ui/status";
import type { Device } from "../../types/domain";

export interface DeviceConnectivity {
  /** `unknown` when the backend itself is unreachable: each device's own
   * `connected` flag is then only as fresh as the last websocket message, so
   * green or red would both be a guess. */
  status: Extract<DotStatus, "online" | "offline" | "unknown">;
  /** Lowercase, e.g. "connected" -- for an aria-label or tooltip. */
  label: string;
  /** Capitalized, e.g. "Connected" -- for display. */
  title: string;
}

/** The one place that combines a device's own flag with backend
 * reachability -- every list dot, map marker and inspector header uses it. */
export function deviceConnectivity(device: Pick<Device, "connected">, backendConnected: boolean): DeviceConnectivity {
  if (!backendConnected) {
    return { status: "unknown", label: "unknown (backend disconnected)", title: "Unknown (backend disconnected)" };
  }
  return device.connected
    ? { status: "online", label: "connected", title: "Connected" }
    : { status: "offline", label: "disconnected", title: "Disconnected" };
}
