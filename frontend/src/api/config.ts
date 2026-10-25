/**
 * Runtime config injected via /public/config.js (config.template.js → envsubst at deploy time).
 * Falls back to localhost defaults for local dev.
 */

const rc = window.RUNTIME_CONFIG ?? {};

const hostname = window.location.hostname;

/** Base URL for REST API, e.g. http://localhost:8000 */
export const API_BASE_URL: string =
  rc.API_BASE_URL ?? `http://${hostname}:8000`;

/** WebSocket URL for live data, e.g. ws://localhost:8000/ws */
export const WS_URL: string =
  rc.WS_URL ?? `ws://${hostname}:8000/ws`;
