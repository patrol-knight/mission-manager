/**
 * Explicit camera/WebRTC adapter selection.
 *
 * cameraApi.ts picks its implementation once at module load based on this value —
 * never by speculatively calling the real endpoint and treating a 501 as "use the mock."
 * The real backend camera endpoint (POST /api/cameras/{id}/session) is a stub today
 * (see backend/api/camera.py), so "mock" is the default everywhere.
 */
export type CameraMode = "mock" | "real";

function normalize(value: string | undefined): CameraMode | null {
  if (value === "mock" || value === "real") return value;
  return null;
}

export function getCameraMode(): CameraMode {
  const runtime = normalize(window.RUNTIME_CONFIG?.CAMERA_MODE);
  if (runtime) return runtime;

  const devFallback = normalize(import.meta.env.VITE_CAMERA_MODE as string | undefined);
  if (devFallback) return devFallback;

  return "mock";
}
