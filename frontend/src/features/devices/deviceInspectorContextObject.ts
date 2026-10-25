import { createContext } from "react";

export interface DeviceInspectorContextValue {
  selectedDeviceId: string | null;
  inspectorOpen: boolean;
  openInspector: (deviceId: string) => void;
  closeInspector: () => void;
}

export const DeviceInspectorContext = createContext<DeviceInspectorContextValue | null>(null);
