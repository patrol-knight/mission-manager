import { describeCameraSessionError, releaseAbandonedSession, startWebrtcSession, type WebrtcSession } from "./webrtcClient";
import { useDeviceStore } from "../stores/deviceStore";
import type { CameraInfo } from "../types/domain";
import type { InspectionSession } from "./cameraApi";

interface ActiveSession {
  session: WebrtcSession;
  unsubscribeStore: () => void;
}

const activeSessions = new Map<string, ActiveSession>();
let abandonedSessionReleased = false;

function toCameraInfo(deviceId: string): CameraInfo | null {
  const camera = useDeviceStore.getState().cameras[deviceId];
  return camera
    ? {
        status: camera.streamState,
        sessionState: camera.sessionState,
        videoSource: camera.videoSource,
        detail: camera.failureCode ? describeCameraSessionError(camera.failureCode) : null,
      }
    : null;
}

/** One camera per device (see the design doc's scope note) -- resolves
 * immediately if the device's camera_id/stream_state is already known
 * (populated by `cameras.snapshot` on WS connect, or a prior camera.updated),
 * otherwise waits for the next store update carrying it. */
function waitForCameraId(deviceId: string): Promise<string | null> {
  const existing = useDeviceStore.getState().cameras[deviceId];
  if (existing) return Promise.resolve(existing.cameraId);

  return new Promise((resolve) => {
    const unsubscribe = useDeviceStore.subscribe((state) => {
      const camera = state.cameras[deviceId];
      if (camera) {
        unsubscribe();
        clearTimeout(timeout);
        resolve(camera.cameraId);
      }
    });
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, 5_000);
  });
}

/**
 * Real adapter -- opens an actual WebRTC session against the device's
 * zenoh_bridge gateway (see api/webrtcClient.ts). `openInspectionSession`
 * reads the device's one camera from the already-synced deviceStore rather
 * than making a network call (no separate "enumerate cameras" round trip,
 * per ../../zenoh_bridge/docs/video_streaming_pipeline.md §3).
 */
export async function openInspectionSession(
  deviceId: string,
  hasCameraCapability: boolean,
  onUpdate: (camera: CameraInfo | null) => void,
  onStream: (stream: MediaStream | null) => void,
): Promise<InspectionSession> {
  if (!abandonedSessionReleased) {
    // A session a previous load of this tab left running (reload, crash).
    abandonedSessionReleased = true;
    releaseAbandonedSession();
  }
  if (!hasCameraCapability) return { sessionId: "", camera: null };

  const cameraId = await waitForCameraId(deviceId);
  if (!cameraId) return { sessionId: "", camera: null };

  let ended = false;
  const unsubscribeStore = useDeviceStore.subscribe(() => {
    if (!ended) onUpdate(toCameraInfo(deviceId));
  });

  let session: WebrtcSession;
  try {
    session = await startWebrtcSession(deviceId, cameraId, {
      onTrack: onStream,
      onEnded: (reason) => {
        // Ended by the gateway/backend, not by closeInspectionSession.
        ended = true;
        unsubscribeStore();
        activeSessions.delete(session?.sessionId);
        onStream(null);
        onUpdate({ status: "error", detail: describeCameraSessionError(reason) });
      },
    });
  } catch (err) {
    unsubscribeStore();
    throw err;
  }

  activeSessions.set(session.sessionId, { session, unsubscribeStore });

  return { sessionId: session.sessionId, camera: toCameraInfo(deviceId) };
}

export async function closeInspectionSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const active = activeSessions.get(sessionId);
  if (!active) return;
  activeSessions.delete(sessionId);
  active.unsubscribeStore();
  await active.session.stop();
}
