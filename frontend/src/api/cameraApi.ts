import { getCameraMode } from "./cameraConfig";
import * as mockCameraApi from "./mockCameraApi";
import * as realCameraApi from "./realCameraApi";
import type { CameraInfo } from "../types/domain";

export interface InspectionSession {
  sessionId: string;
  cameras: CameraInfo[];
}

export interface CameraApiImpl {
  openInspectionSession(
    deviceId: string,
    hasCameraCapability: boolean,
    onUpdate: (cameras: CameraInfo[]) => void,
    onStream: (cameraId: string, stream: MediaStream | null) => void,
  ): Promise<InspectionSession>;
  closeInspectionSession(sessionId: string): Promise<void>;
}

const impl: CameraApiImpl = getCameraMode() === "real" ? realCameraApi : mockCameraApi;

export function openInspectionSession(
  deviceId: string,
  hasCameraCapability: boolean,
  onUpdate: (cameras: CameraInfo[]) => void,
  onStream: (cameraId: string, stream: MediaStream | null) => void,
): Promise<InspectionSession> {
  return impl.openInspectionSession(deviceId, hasCameraCapability, onUpdate, onStream);
}

export function closeInspectionSession(sessionId: string): Promise<void> {
  return impl.closeInspectionSession(sessionId);
}
