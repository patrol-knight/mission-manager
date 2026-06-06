import { useEffect, useState } from "react";
import { getWebSocket } from "../api/websocket";
import type { ConnectionStatus } from "../types";

/**
 * Returns the current WebSocket connection status.
 * Components can use this to show connected / disconnected UI.
 */
export function useApiConnection(): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const unsub = getWebSocket().onStatus(setStatus);
    return unsub;
  }, []);

  return { status };
}
