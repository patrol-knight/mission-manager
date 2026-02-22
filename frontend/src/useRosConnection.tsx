import { useEffect, useState } from "react";
import { ros } from "./ros";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useRosConnection() {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    // roslib exposes the url on the Ros instance
    const rosUrl = (ros as any).socket?.url ?? "";
    setUrl(rosUrl);

    const onConnect = () => {
      const u = (ros as any).socket?.url ?? "";
      setUrl(u);
      setStatus("connected");
    };
    const onError = () => setStatus("disconnected");
    const onClose = () => setStatus("disconnected");

    ros.on("connection", onConnect);
    ros.on("error", onError);
    ros.on("close", onClose);

    return () => {
      ros.off("connection", onConnect);
      ros.off("error", onError);
      ros.off("close", onClose);
    };
  }, []);

  return { status, url };
}