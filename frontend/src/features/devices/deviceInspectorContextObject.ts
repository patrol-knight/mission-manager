import { createContext } from "react";

export interface DeviceInspectorContextValue {
  selectedDeviceId: string | null;
  inspectorOpen: boolean;
  selectedCameraId: string | null;
  openInspector: (deviceId: string) => void;
  closeInspector: () => void;
  focusCamera: (cameraId: string | null) => void;
}

export const DeviceInspectorContext = createContext<DeviceInspectorContextValue | null>(null);
