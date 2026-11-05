import { WS_URL } from "../../api/config";
import { useDevStore, type DevWindow } from "./devStore";

export type BrowserRowsProvider = () => Promise<Record<string, unknown>[]>;

const RETRY_MS = 2_000;
const PING_MS = 1_000;

function devSocketUrl(): string {
  const url = new URL(WS_URL);
  url.pathname = "/api/dev/ws";
  return url.toString();
}

/** The /dev page's own socket: 1 s windows in, WebSocket RTT probes and
 * browser-side samples (WebRTC stats) out. */
export function connectDevSocket(getWebrtcRows: () => BrowserRowsProvider | null): () => void {
  const store = useDevStore.getState();
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastRtt: number | null = null;

  const open = () => {
    ws = new WebSocket(devSocketUrl());
    ws.onopen = () => store.setConnected(true);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as { type: string; t?: number; data?: DevWindow };
      if (msg.type === "pong" && typeof msg.t === "number") {
        lastRtt = performance.now() - msg.t;
        store.addWsRtt(lastRtt);
      } else if (msg.type === "dev.window" && msg.data) {
        store.addWindow(msg.data);
      }
    };
    ws.onclose = () => {
      store.setConnected(false);
      ws = null;
      if (!closed) retry = setTimeout(open, RETRY_MS);
    };
  };
  open();

  const timer = setInterval(async () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "ping", t: performance.now() }));
    const provider = getWebrtcRows();
    const webrtc = provider ? await provider().catch(() => []) : [];
    ws?.send(JSON.stringify({ type: "browser", ws_rtt_ms: lastRtt, webrtc }));
    lastRtt = null;
  }, PING_MS);

  return () => {
    closed = true;
    clearInterval(timer);
    if (retry) clearTimeout(retry);
    ws?.close();
  };
}
