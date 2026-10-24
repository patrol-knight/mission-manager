import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DeviceInspectorContext } from "./deviceInspectorContextObject";
import { useInvestigationStore } from "../../stores/investigationStore";

/** Only one camera window is open at a time -- the device window here or the
 * verify window (VerifyModal) -- so two WebRTC streams never run side by side
 * and windows never stack. Opening either closes the other; the verify
 * window opening on its own when the robot arrives wins the same way. */
export function DeviceInspectorProvider({ children }: { children: ReactNode }) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const openInspector = useCallback((deviceId: string) => {
    useInvestigationStore.getState().closeVerify();
    setSelectedDeviceId(deviceId);
    setInspectorOpen(true);
  }, []);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelectedDeviceId(null);
  }, []);

  useEffect(
    () =>
      useInvestigationStore.subscribe((s, prev) => {
        if (s.verifyOpen && !prev.verifyOpen) closeInspector();
      }),
    [closeInspector],
  );

  const value = useMemo(
    () => ({ selectedDeviceId, inspectorOpen, openInspector, closeInspector }),
    [selectedDeviceId, inspectorOpen, openInspector, closeInspector],
  );

  return <DeviceInspectorContext.Provider value={value}>{children}</DeviceInspectorContext.Provider>;
}
