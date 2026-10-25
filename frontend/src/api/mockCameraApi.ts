import type { CameraInfo } from "../types/domain";
import type { InspectionSession } from "./cameraApi";

/**
 * Fake session: returns the device's one canned camera (only if the device
 * advertises the "camera" capability) and transitions it from "connecting"
 * to "live".
 */
export async function openInspectionSession(
  deviceId: string,
  hasCameraCapability: boolean,
  onUpdate: (camera: CameraInfo | null) => void,
  // Mock never produces a real MediaStream -- signature still matches CameraApiImpl.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _onStream: (stream: MediaStream | null) => void,
): Promise<InspectionSession> {
  const sessionId = `mock-session-${deviceId}-${Date.now()}`;
  if (!hasCameraCapability) return { sessionId, camera: null };

  setTimeout(() => onUpdate({ status: "live" }), 400);

  return { sessionId, camera: { status: "connecting" } };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature matches CameraApiImpl
export async function closeInspectionSession(_sessionId: string): Promise<void> {
  // Nothing to release — no real media resources exist in the mock.
}
