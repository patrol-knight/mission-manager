import { ApiError, http } from "./httpClient";
import { API_BASE_URL } from "./config";
import { getRealtimeClient, type CameraSessionEnded, type RawCameraSignal } from "./realtimeClient";
import type { CameraState } from "../types/domain";

/** Why a camera session couldn't start or ended -- `code` is the backend's
 * machine-readable reason (camera_busy, session_stopping, gateway_timeout, ...). */
export class CameraSessionError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "CameraSessionError";
    this.code = code;
    this.status = status;
  }
}

export interface WebrtcSessionCallbacks {
  onTrack: (stream: MediaStream) => void;
  /** The browser's own view of the media connection (RTCPeerConnection.connectionState). */
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  /** The gateway's view of this session (camera.session.updated). */
  onSessionState?: (state: CameraState) => void;
  /** The session ended without stop() -- by the gateway, the backend, or a failed resume. */
  onEnded?: (reason: string) => void;
}

export interface WebrtcSession {
  sessionId: string;
  stop: () => Promise<void>;
}

/** sessionStorage record of the session this tab is running -- what a
 * reloaded page uses to tell the backend the old one is abandoned. */
const ACTIVE_SESSION_KEY = "camera.activeSession";

interface StoredSession {
  deviceId: string;
  cameraId: string;
  sessionId: string;
  connectionId: string;
}

// Signals that couldn't be sent while the WebSocket was reconnecting: kept
// for this session only, and only briefly -- anything older than the
// backend's owner grace period is useless (the session will be gone).
const MAX_OUTBOX = 50;
const OUTBOX_TTL_MS = 10_000;
const CONNECTION_WAIT_MS = 5_000;

function streamPath(deviceId: string, cameraId: string): string {
  return `/api/cameras/${encodeURIComponent(deviceId)}/${encodeURIComponent(cameraId)}/stream`;
}

function stopPath(deviceId: string, cameraId: string, sessionId: string): string {
  return `${streamPath(deviceId, cameraId)}/${encodeURIComponent(sessionId)}/stop`;
}

function toSessionError(err: unknown): CameraSessionError {
  if (err instanceof ApiError) {
    const body = err.body as { code?: unknown } | undefined;
    const code = typeof body?.code === "string" ? body.code : `http_${err.status}`;
    return new CameraSessionError(code, err.message, err.status);
  }
  return new CameraSessionError("network_error", err instanceof Error ? err.message : "request failed");
}

const ERROR_TEXT: Record<string, string> = {
  camera_busy: "The camera is in use by another viewer.",
  session_stopping: "The previous camera session is still closing -- try again in a moment.",
  device_unavailable: "The device is offline.",
  device_unreachable: "The device can't be reached.",
  gateway_timeout: "The device didn't respond in time.",
  no_connection: "Not connected to the server.",
  negotiation_timeout: "The video connection couldn't be established.",
  ice_failed: "The video connection was lost.",
  pipeline_error: "The device's video pipeline failed.",
  pipeline_failed: "The device couldn't start its video pipeline.",
  gateway_restarted: "The device restarted.",
  owner_disconnected: "The camera session was closed after losing the server connection.",
};

/** A user-facing sentence for a CameraSessionError or a session end reason. */
export function describeCameraSessionError(reason: unknown): string {
  const code = reason instanceof CameraSessionError ? reason.code : typeof reason === "string" ? reason : null;
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (reason instanceof Error) return reason.message;
  return code ? `Camera session ended (${code}).` : "Camera session failed.";
}

/**
 * Tells the backend a session a previous page load left behind is
 * abandoned. Best effort and never reuses its id -- a fresh session always
 * gets a new one. The backend's owner grace period covers this failing.
 */
export function releaseAbandonedSession(): void {
  let stored: StoredSession | null = null;
  try {
    const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    stored = raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return;
  }
  if (!stored) return;
  http
    .post(stopPath(stored.deviceId, stored.cameraId, stored.sessionId), { connection_id: stored.connectionId })
    .catch(() => {});
}

/**
 * One viewer session on one device's camera (one camera per device -- see
 * the design doc's scope note). The gateway always creates the SDP offer;
 * this client only answers, per ../../zenoh_bridge/docs/video_streaming_pipeline.md §3.
 *
 * Ordering: the session id is generated here and every listener is in place
 * before Start is POSTed, so an offer arriving before the POST returns is
 * never lost. Remote ICE candidates wait for the offer to be applied. A
 * WebSocket reconnect resumes the session's signaling on the new connection
 * (the RTCPeerConnection itself doesn't depend on the WebSocket).
 */
export async function startWebrtcSession(
  deviceId: string,
  cameraId: string,
  callbacks: WebrtcSessionCallbacks,
): Promise<WebrtcSession> {
  const client = getRealtimeClient();
  let ownerConnectionId: string;
  try {
    ownerConnectionId = await client.waitForConnection(CONNECTION_WAIT_MS);
  } catch {
    throw new CameraSessionError("no_connection", "No realtime connection to the backend");
  }

  const sessionId = crypto.randomUUID();
  const pc = new RTCPeerConnection({ iceServers: [] });
  let closed = false;
  let offerSeen = false;
  let offerApplied = false;
  const pendingCandidates: RTCIceCandidateInit[] = [];
  const seenCandidates = new Set<string>();
  const outbox: { message: RawCameraSignal; at: number }[] = [];
  // Signals are applied strictly in arrival order.
  let chain: Promise<void> = Promise.resolve();

  const sendSignal = (fields: Pick<RawCameraSignal, "type"> & Partial<RawCameraSignal>) => {
    if (closed) return;
    const message: RawCameraSignal = { device_id: deviceId, camera_id: cameraId, session_id: sessionId, ...fields };
    if (!client.send({ type: "camera.signal", data: message })) {
      outbox.push({ message, at: Date.now() });
      if (outbox.length > MAX_OUTBOX) outbox.shift();
    }
  };

  const flushOutbox = () => {
    const now = Date.now();
    const queued = outbox.splice(0).filter((entry) => now - entry.at <= OUTBOX_TTL_MS);
    for (const entry of queued) {
      if (!client.send({ type: "camera.signal", data: entry.message })) outbox.push(entry);
    }
  };

  const applySignal = async (signal: RawCameraSignal) => {
    if (signal.type === "offer" && signal.sdp) {
      if (offerSeen) return; // one offer per session -- a duplicate is ignored
      offerSeen = true;
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      offerApplied = true;
      for (const candidate of pendingCandidates.splice(0)) {
        await pc.addIceCandidate(candidate);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal({ type: "answer", sdp: answer.sdp });
    } else if (signal.type === "ice-candidate" && signal.candidate) {
      if (seenCandidates.has(signal.candidate)) return;
      seenCandidates.add(signal.candidate);
      const candidate = { candidate: signal.candidate, sdpMLineIndex: signal.sdp_mline_index ?? undefined };
      if (offerApplied) {
        await pc.addIceCandidate(candidate);
      } else {
        pendingCandidates.push(candidate);
      }
    }
  };

  const onPageHide = () => {
    // Best effort only: the page is going away with its RTCPeerConnection.
    // text/plain keeps it a CORS "simple" request -- a beacon can't do the
    // preflight a cross-origin application/json POST would need.
    const body = new Blob([JSON.stringify({ connection_id: ownerConnectionId })], { type: "text/plain;charset=UTF-8" });
    navigator.sendBeacon?.(`${API_BASE_URL}${stopPath(deviceId, cameraId, sessionId)}`, body);
  };

  const unsubscribers: (() => void)[] = [];
  const release = () => {
    closed = true;
    unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    window.removeEventListener("pagehide", onPageHide);
    pc.close();
    outbox.length = 0;
    try {
      const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
      if (raw && (JSON.parse(raw) as StoredSession).sessionId === sessionId) {
        sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {
      // storage unavailable -- nothing to clean up
    }
  };

  const end = (reason: string) => {
    if (closed) return;
    release();
    callbacks.onEnded?.(reason);
  };

  pc.ontrack = (event) => {
    if (!closed && event.streams[0]) callbacks.onTrack(event.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (!closed) callbacks.onConnectionStateChange?.(pc.connectionState);
  };
  pc.onicecandidate = (event) => {
    if (!event.candidate?.candidate) return;
    sendSignal({
      type: "ice-candidate",
      candidate: event.candidate.candidate,
      sdp_mline_index: event.candidate.sdpMLineIndex,
    });
  };

  // Everything this session listens to is in place before Start goes out.
  unsubscribers.push(
    client.onCameraSignal((signal) => {
      if (closed || signal.session_id !== sessionId) return;
      chain = chain
        .then(() => (closed ? undefined : applySignal(signal)))
        .catch((err: unknown) => console.warn(`[webrtc] Failed to apply ${signal.type}:`, err));
    }),
    client.onCameraSessionUpdate((state) => {
      if (!closed && state.sessionId === sessionId) callbacks.onSessionState?.(state);
    }),
    client.onCameraSessionEnded((ended: CameraSessionEnded) => {
      if (ended.session_id === sessionId) end(ended.failure_code ?? ended.reason);
    }),
    client.onCameraSessionReply((kind, reply) => {
      if (closed || reply.session_id !== sessionId) return;
      if (kind === "resumed") {
        ownerConnectionId = client.getConnectionId() ?? ownerConnectionId;
        flushOutbox();
      } else if (kind === "resume_failed") {
        end(reply.code ?? "resume_failed");
      } else {
        console.warn("[webrtc] Signal rejected:", reply.code);
      }
    }),
    client.onConnectionReady((connectionId) => {
      if (closed || connectionId === ownerConnectionId) return;
      // A new WebSocket: claim this session's signaling on it.
      client.send({
        type: "camera.session.resume",
        data: { session_id: sessionId, previous_connection_id: ownerConnectionId },
      });
    }),
  );

  try {
    await http.post(streamPath(deviceId, cameraId), { session_id: sessionId, connection_id: ownerConnectionId });
  } catch (err) {
    release();
    throw toSessionError(err);
  }
  if (closed) {
    // Ended (camera.session.ended) while the POST was in flight.
    throw new CameraSessionError("session_ended", "Camera session ended while starting");
  }

  try {
    const stored: StoredSession = { deviceId, cameraId, sessionId, connectionId: ownerConnectionId };
    sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(stored));
  } catch {
    // storage unavailable -- the backend's grace period still covers a reload
  }
  window.addEventListener("pagehide", onPageHide);

  return {
    sessionId,
    stop: async () => {
      if (closed) return;
      const connectionId = ownerConnectionId;
      release();
      try {
        await http.post(stopPath(deviceId, cameraId, sessionId), { connection_id: connectionId });
      } catch {
        // Best effort: if this never arrives, the backend stops the session
        // once this page's WebSocket has been gone for its grace period.
      }
    },
  };
}
