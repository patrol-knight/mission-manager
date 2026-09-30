import { useCallback, useState, type ReactNode } from "react";
import { DeviceInspectorContext } from "./deviceInspectorContextObject";

export function DeviceInspectorProvider({ children }: { children: ReactNode }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const openInspector = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setInspectorOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedDeviceId(null);
  }, []);

  return (
    <DeviceInspectorContext.Provider
      value={{
        selectedDeviceId,
        inspectorOpen,
        openInspector,
        closeInspector,
      }}
    >
      {children}
    </DeviceInspectorContext.Provider>
  );
}
