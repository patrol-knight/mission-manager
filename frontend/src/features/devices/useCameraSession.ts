import { useEffect, useState } from "react";
import { openInspectionSession, closeInspectionSession } from "../../api/cameraApi";
import type { CameraInfo } from "../../types/domain";

/**
 * Owns the open-on-mount / close-on-unmount session lifecycle. Mock-backed this
 * pass (see api/cameraConfig.ts) — swapping in real WebRTC later only touches
 * api/cameraApi.ts and api/realCameraApi.ts, not this hook or any UI component.
 */
export function useCameraSession(
  deviceId: string | null,
  hasCameraCapability: boolean,
): { cameras: CameraInfo[]; error: string | null } {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    let sessionId: string | null = null;

    openInspectionSession(deviceId, hasCameraCapability, (updated) => {
      if (!cancelled) setCameras(updated);
    })
      .then((session) => {
        if (cancelled) {
          closeInspectionSession(session.sessionId).catch(() => {});
          return;
        }
        sessionId = session.sessionId;
        setCameras(session.cameras);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to open camera session");
      });

    return () => {
      cancelled = true;
      setCameras([]);
      setError(null);
      if (sessionId) closeInspectionSession(sessionId).catch(() => {});
    };
  }, [deviceId, hasCameraCapability]);

  return { cameras, error };
}
