interface RuntimeConfig {
  /** Base URL for the FastAPI backend, e.g. "http://localhost:8000" */
  API_BASE_URL?: string;
  /** WebSocket URL, e.g. "ws://localhost:8000/ws" */
  WS_URL?: string;
  /** Camera/WebRTC adapter to use: "mock" (default) or "real". See src/api/cameraConfig.ts */
  CAMERA_MODE?: string;
}

interface Window {
  RUNTIME_CONFIG?: RuntimeConfig;
}
