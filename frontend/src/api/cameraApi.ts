import { getCameraMode } from "./cameraConfig";
import * as mockCameraApi from "./mockCameraApi";
import * as realCameraApi from "./realCameraApi";
import type { CameraInfo } from "../types/domain";

/** Every device has exactly one camera, so a session is about that one
 * camera -- `camera` is null when the device has none. */
export interface InspectionSession {
  sessionId: string;
  camera: CameraInfo | null;
}

export interface CameraApiImpl {
  openInspectionSession(
    deviceId: string,
    hasCameraCapability: boolean,
    onUpdate: (camera: CameraInfo | null) => void,
    onStream: (stream: MediaStream | null) => void,
  ): Promise<InspectionSession>;
  closeInspectionSession(sessionId: string): Promise<void>;
}

const impl: CameraApiImpl = getCameraMode() === "real" ? realCameraApi : mockCameraApi;

export function openInspectionSession(
  deviceId: string,
  hasCameraCapability: boolean,
  onUpdate: (camera: CameraInfo | null) => void,
  onStream: (stream: MediaStream | null) => void,
): Promise<InspectionSession> {
  return impl.openInspectionSession(deviceId, hasCameraCapability, onUpdate, onStream);
}

export function closeInspectionSession(sessionId: string): Promise<void> {
  return impl.closeInspectionSession(sessionId);
}
