export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * Generic envelope for every message on /ws — see backend/models/state.py::WebSocketEvent.
 * Payload shapes for `data` are refined per-event by realtimeClient's dispatch, not here:
 * some event types (mission.execution.updated, anomaly.*) aren't emitted by the backend yet
 * and are typed loosely (`unknown`) until their producing milestone lands.
 */
export interface WsEnvelope<T extends string = string, D = unknown> {
  type: T;
  data: D;
}
