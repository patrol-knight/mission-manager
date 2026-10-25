import { useEffect, useState } from "react";
import { getRealtimeClient } from "../api/realtimeClient";
import type { ConnectionStatus } from "../types/ws";

/** Current realtime connection status, for connection-indicator UI. */
export function useApiConnection(): { status: ConnectionStatus } {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    return getRealtimeClient().onStatus(setStatus);
  }, []);

  return { status };
}
