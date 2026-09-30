import { useEffect, useState } from "react";
import { openInspectionSession, closeInspectionSession } from "../../api/cameraApi";
import type { CameraInfo } from "../../types/domain";

/**
 * Owns the open-on-mount / close-on-unmount session lifecycle -- the shared
 * seam both DeviceInspectorOverlay and AnomalyVerifyModal drive their camera
 * UI through (see api/cameraApi.ts's mock/real switch). Every device has
 * exactly one camera; `stream` is populated once WebRTC negotiation
 * completes and the gateway's track arrives (real mode only -- always null
 * in mock mode).
 */
export function useCameraSession(
  deviceId: string | null,
  hasCameraCapability: boolean,
): { camera: CameraInfo | null; stream: MediaStream | null; error: string | null } {
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    let sessionId: string | null = null;

    openInspectionSession(
      deviceId,
      hasCameraCapability,
      (updated) => {
        if (!cancelled) setCamera(updated);
      },
      (next) => {
        if (!cancelled) setStream(next);
      },
    )
      .then((session) => {
        if (cancelled) {
          closeInspectionSession(session.sessionId).catch(() => {});
          return;
        }
        sessionId = session.sessionId;
        setCamera(session.camera);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to open camera session");
      });

    return () => {
      cancelled = true;
      setCamera(null);
      setStream(null);
      setError(null);
      if (sessionId) closeInspectionSession(sessionId).catch(() => {});
    };
  }, [deviceId, hasCameraCapability]);

  return { camera, stream, error };
}
