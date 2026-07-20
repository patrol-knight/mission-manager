import { createContext } from "react";

export interface DeviceInspectorContextValue {
  selectedDeviceId: string | null;
  inspectorOpen: boolean;
  selectedCameraId: string | null;
  /** Set only when the inspector was opened for anomaly review (from the
   * arrival toast) — gates the Verify Anomaly footer action. */
  anomalyContext: string | null;
  openInspector: (deviceId: string) => void;
  openInspectorForAnomaly: (deviceId: string, anomalyId: string) => void;
  closeInspector: () => void;
  focusCamera: (cameraId: string | null) => void;
}

export const DeviceInspectorContext = createContext<DeviceInspectorContextValue | null>(null);
