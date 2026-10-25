/** Camera/WebRTC adapter, picked once at module load by cameraApi.ts: "real"
 * streams through POST /api/cameras/{device}/{camera}/stream, "mock" (the
 * default) fakes it. */
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
