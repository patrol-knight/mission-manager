import { WS_URL } from "./config";
import type { WsMessage, ConnectionStatus } from "../types";

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (msg: WsMessage) => void;

const BASE_DELAY = 2_000;
const MAX_DELAY = 30_000;

class RobotWebSocket {
  private ws: WebSocket | null = null;
  private retryDelay = BASE_DELAY;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  private statusListeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();

  private _status: ConnectionStatus = "connecting";

  constructor() {
    this.connect();
  }

  // ── Public subscribe / unsubscribe ────────────────────────────────────────

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this._status); // immediately fire current status
    return () => this.statusListeners.delete(fn);
  }

  onMessage(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private setStatus(s: ConnectionStatus) {
    this._status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private connect() {
    if (this.destroyed) return;

    this.setStatus("connecting");
    const ws = new WebSocket(WS_URL);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = BASE_DELAY;
      this.setStatus("connected");
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsMessage;
        this.messageListeners.forEach((fn) => fn(msg));
      } catch {
        console.warn("[WS] Failed to parse message:", ev.data);
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose, handle there
    };

    ws.onclose = () => {
      if (this.destroyed) return;
      this.setStatus("disconnected");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.retryTimer || this.destroyed) return;
    console.warn(`[WS] Reconnecting in ${this.retryDelay / 1000}s…`);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, MAX_DELAY);
      this.connect();
    }, this.retryDelay);
  }
}

// Singleton — one WebSocket for the whole app lifetime
let instance: RobotWebSocket | null = null;

export function getWebSocket(): RobotWebSocket {
  if (!instance) instance = new RobotWebSocket();
  return instance;
}
