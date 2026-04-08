// This file is processed at container startup via envsubst.
// It injects runtime environment variables into the browser.
// Vite bakes only BUILD-TIME env; this handles RUNTIME env for Docker deployments.
window.RUNTIME_CONFIG = {
  // REST base URL for FastAPI backend. "http://robot-host:8000"
  API_BASE_URL: "${API_BASE_URL}",
  // WebSocket endpoint. "ws://robot-host:8000/ws"
  WS_URL: "${WS_URL}",
};
