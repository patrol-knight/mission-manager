// This file is processed at container startup via envsubst.
// It injects runtime environment variables into the browser.
// Vite bakes only BUILD-TIME env; this handles RUNTIME env for Docker deployments.
window.RUNTIME_CONFIG = {
  // REST base URL for FastAPI backend. "http://robot-host:8000"
  API_BASE_URL: "${API_BASE_URL}",
  // WebSocket endpoint. "ws://robot-host:8000/ws"
  WS_URL: "${WS_URL}",
  // Camera/WebRTC adapter: "mock" or "real". Defaults to "mock" until the backend
  // camera endpoint is implemented for real (see backend/api/camera.py).
  CAMERA_MODE: "${CAMERA_MODE}",
};

if (!window.RUNTIME_CONFIG.API_BASE_URL) {
  console.warn("API_BASE_URL not set, fallback to localhost");
  window.RUNTIME_CONFIG.API_BASE_URL = "http://localhost:8000";
}

if (!window.RUNTIME_CONFIG.WS_URL) {
  window.RUNTIME_CONFIG.WS_URL = "ws://localhost:8000/ws";
}

if (!window.RUNTIME_CONFIG.CAMERA_MODE) {
  window.RUNTIME_CONFIG.CAMERA_MODE = "mock";
}
