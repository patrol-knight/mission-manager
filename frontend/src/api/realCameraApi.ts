/* eslint-disable @typescript-eslint/no-unused-vars -- signature matches CameraApiImpl;
   hasCameraCapability/onUpdate/sessionId will be used once real WebRTC signaling lands. */
import { http } from "./httpClient";
import type { CameraInfo } from "../types/domain";
import type { InspectionSession } from "./cameraApi";

/**
 * Real adapter — calls the actual backend endpoint and lets whatever it returns
 * (currently a 501, since backend/api/camera.py is a stub) surface as a normal
 * error. Never falls back to the mock automatically; CAMERA_MODE selects this
 * adapter explicitly (see cameraConfig.ts).
 */
export async function openInspectionSession(
  deviceId: string,
  _hasCameraCapability: boolean,
  _onUpdate: (cameras: CameraInfo[]) => void,
): Promise<InspectionSession> {
  return http.post<InspectionSession>(`/api/cameras/${encodeURIComponent(deviceId)}/session`);
}

export async function closeInspectionSession(_sessionId: string): Promise<void> {
  // No corresponding "end session" endpoint exists on the backend yet.
}
