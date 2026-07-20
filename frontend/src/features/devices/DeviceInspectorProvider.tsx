import { useCallback, useState, type ReactNode } from "react";
import { DeviceInspectorContext } from "./deviceInspectorContextObject";

export function DeviceInspectorProvider({ children }: { children: ReactNode }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [anomalyContext, setAnomalyContext] = useState<string | null>(null);

  const openInspector = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setInspectorOpen(true);
    setSelectedCameraId(null);
    setAnomalyContext(null);
  }, []);

  const openInspectorForAnomaly = useCallback((deviceId: string, anomalyId: string) => {
    setSelectedDeviceId(deviceId);
    setInspectorOpen(true);
    setSelectedCameraId(null);
    setAnomalyContext(anomalyId);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedDeviceId(null);
    setSelectedCameraId(null);
    setAnomalyContext(null);
  }, []);

  const focusCamera = useCallback((cameraId: string | null) => setSelectedCameraId(cameraId), []);

  return (
    <DeviceInspectorContext.Provider
      value={{
        selectedDeviceId,
        inspectorOpen,
        selectedCameraId,
        anomalyContext,
        openInspector,
        openInspectorForAnomaly,
        closeInspector,
        focusCamera,
      }}
    >
      {children}
    </DeviceInspectorContext.Provider>
  );
}
