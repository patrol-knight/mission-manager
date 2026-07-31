import { http } from "./httpClient";
import { getRealtimeClient, type RawCameraSignal } from "./realtimeClient";
import type { CameraStreamStatus } from "../types/domain";

interface StartCameraStreamResponse {
  session_id: string;
}

export interface WebrtcSessionCallbacks {
  onTrack: (stream: MediaStream) => void;
  /** ICE-connection-derived status, distinct from the gateway's own
   * `stream_state` (camera.updated) -- this only reflects whether the
   * media-plane peer connection itself is up. */
  onConnectionStateChange?: (state: CameraStreamStatus) => void;
}

export interface WebrtcSession {
  sessionId: string;
  stop: () => Promise<void>;
}

function iceConnectionStateToStreamStatus(state: RTCIceConnectionState): CameraStreamStatus {
  switch (state) {
    case "checking":
      return "connecting";
    case "connected":
    case "completed":
      return "live";
    case "failed":
    case "disconnected":
    case "closed":
      return "error";
    default:
      return "connecting";
  }
}

/**
 * Owns one RTCPeerConnection for one device's one camera (see the design
 * doc's one-camera-per-device scope note). The gateway always creates the
 * SDP offer -- this client only ever answers, per
 * ../../zenoh_bridge/docs/video_streaming_pipeline.md §3.
 */
export async function startWebrtcSession(
  deviceId: string,
  cameraId: string,
  callbacks: WebrtcSessionCallbacks,
): Promise<WebrtcSession> {
  const { session_id: sessionId } = await http.post<StartCameraStreamResponse>(
    `/api/cameras/${encodeURIComponent(deviceId)}/${encodeURIComponent(cameraId)}/stream`,
  );

  const pc = new RTCPeerConnection({ iceServers: [] });
  const client = getRealtimeClient();

  pc.ontrack = (event) => {
    if (event.streams[0]) callbacks.onTrack(event.streams[0]);
  };
  pc.oniceconnectionstatechange = () => {
    callbacks.onConnectionStateChange?.(iceConnectionStateToStreamStatus(pc.iceConnectionState));
  };
  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    client.send({
      type: "camera.signal",
      data: {
        device_id: deviceId,
        camera_id: cameraId,
        session_id: sessionId,
        type: "ice-candidate",
        candidate: event.candidate.candidate,
        sdp_mline_index: event.candidate.sdpMLineIndex,
      },
    });
  };

  const unsubscribe = client.onCameraSignal((signal: RawCameraSignal) => {
    if (signal.session_id !== sessionId) return;

    if (signal.type === "offer" && signal.sdp) {
      pc.setRemoteDescription({ type: "offer", sdp: signal.sdp })
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer).then(() => answer))
        .then((answer) => {
          client.send({
            type: "camera.signal",
            data: {
              device_id: deviceId,
              camera_id: cameraId,
              session_id: sessionId,
              type: "answer",
              sdp: answer.sdp,
            },
          });
        })
        .catch((err: unknown) => {
          console.warn("[webrtc] Failed to answer offer:", err);
        });
    } else if (signal.type === "ice-candidate" && signal.candidate) {
      pc.addIceCandidate({
        candidate: signal.candidate,
        sdpMLineIndex: signal.sdp_mline_index ?? undefined,
      }).catch((err: unknown) => {
        console.warn("[webrtc] Failed to add remote ICE candidate:", err);
      });
    }
  });

  return {
    sessionId,
    stop: async () => {
      unsubscribe();
      pc.close();
      try {
        await http.post(
          `/api/cameras/${encodeURIComponent(deviceId)}/${encodeURIComponent(cameraId)}/stream/${encodeURIComponent(sessionId)}/stop`,
        );
      } catch {
        // Best-effort: the gateway's own ICE-stale watchdog tears the stream
        // down anyway if this never arrives (implicit-abandonment path).
      }
    },
  };
}
