import type { CameraInfo, CameraStreamStatus } from "../types/domain";
import type { InspectionSession } from "./cameraApi";

const MOCK_CAMERA_NAMES = ["Front", "Rear", "Overhead"];

/**
 * Fake session: returns canned cameras (only if the device advertises the
 * "camera" capability) and independently transitions each one from
 * "connecting" to "live" — except one, which goes to "error", demonstrating
 * that a single failed stream doesn't block the others.
 */
export async function openInspectionSession(
  deviceId: string,
  hasCameraCapability: boolean,
  onUpdate: (cameras: CameraInfo[]) => void,
): Promise<InspectionSession> {
  const sessionId = `mock-session-${deviceId}-${Date.now()}`;
  if (!hasCameraCapability) return { sessionId, cameras: [] };

  let cameras: CameraInfo[] = MOCK_CAMERA_NAMES.map((name, i) => ({
    id: `${deviceId}-cam-${i}`,
    name,
    status: "connecting",
  }));

  MOCK_CAMERA_NAMES.forEach((_, i) => {
    setTimeout(() => {
      const nextStatus: CameraStreamStatus = i === 2 ? "error" : "live";
      cameras = cameras.map((c, idx) => (idx === i ? { ...c, status: nextStatus } : c));
      onUpdate(cameras);
    }, 400 + i * 250);
  });

  return { sessionId, cameras };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature matches CameraApiImpl
export async function closeInspectionSession(_sessionId: string): Promise<void> {
  // Nothing to release — no real media resources exist in the mock.
}
