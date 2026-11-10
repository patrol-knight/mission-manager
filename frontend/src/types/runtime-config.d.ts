interface RuntimeConfig {
  /** Base URL for the FastAPI backend, e.g. "http://localhost:8000" */
  API_BASE_URL?: string;
  /** WebSocket URL, e.g. "ws://localhost:8000/ws" */
  WS_URL?: string;
}

interface Window {
  RUNTIME_CONFIG?: RuntimeConfig;
}
