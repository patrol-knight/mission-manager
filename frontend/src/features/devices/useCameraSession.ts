import { useEffect, useState } from "react";
import { openInspectionSession, closeInspectionSession } from "../../api/cameraApi";
import type { CameraInfo } from "../../types/domain";

/**
 * Owns the open-on-mount / close-on-unmount session lifecycle -- the shared
 * seam both DeviceInspectorOverlay and AnomalyVerifyModal drive their camera
 * UI through (see api/cameraApi.ts's mock/real switch). `streams` is keyed by
 * camera id, populated once WebRTC negotiation completes and the gateway's
 * track arrives (real mode only -- always empty in mock mode).
 */
export function useCameraSession(
  deviceId: string | null,
  hasCameraCapability: boolean,
): { cameras: CameraInfo[]; streams: Record<string, MediaStream>; error: string | null } {
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    let sessionId: string | null = null;

    openInspectionSession(
      deviceId,
      hasCameraCapability,
      (updated) => {
        if (!cancelled) setCameras(updated);
      },
      (cameraId, stream) => {
        if (cancelled) return;
        setStreams((prev) => {
          if (stream) return { ...prev, [cameraId]: stream };
          if (!(cameraId in prev)) return prev;
          const next = { ...prev };
          delete next[cameraId];
          return next;
        });
      },
    )
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
      setStreams({});
      setError(null);
      if (sessionId) closeInspectionSession(sessionId).catch(() => {});
    };
  }, [deviceId, hasCameraCapability]);

  return { cameras, streams, error };
}
