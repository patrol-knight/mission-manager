import { useEffect, useState } from "react";
import { getWebSocket } from "../api/websocket";
import type { PathData } from "../types";

/**
 * Streams mission path updates pushed by the backend over WebSocket.
 */
export function useMissionPath(): PathData | null {
  const [path, setPath] = useState<PathData | null>(null);

  useEffect(() => {
    const unsub = getWebSocket().onMessage((msg) => {
      if (msg.type === "path") {
        setPath({
          points: msg.payload.points,
          frameId: msg.payload.frame_id,
        });
      }
    });
    return unsub;
  }, []);

  return path;
}
