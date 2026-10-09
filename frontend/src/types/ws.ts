export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Generic envelope for every message on /ws — see backend/api/websocket.py.
 * Payload shapes for `data` are refined per event by realtimeClient's dispatch.
 */
export interface WsEnvelope<T extends string = string, D = unknown> {
  type: T;
  data: D;
}
