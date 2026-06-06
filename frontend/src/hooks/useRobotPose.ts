import { useEffect, useRef, useState } from "react";
import { getWebSocket } from "../api/websocket";
import type { RobotPose } from "../types";

const ROBOT_TIMEOUT_MS = 1500;

export function useRobotPose(): RobotPose | null {
  const [pose, setPose] = useState<RobotPose | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearPoseAfterTimeout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setPose(null);
      }, ROBOT_TIMEOUT_MS);
    };

    const unsubMsg = getWebSocket().onMessage((msg) => {
      let newPose: RobotPose | null = null;

      if (msg.type === "robot_pose") {
        newPose = msg.payload;
      } else {
        const flat = msg as unknown as Record<string, unknown>;
        if (typeof flat.x === "number" && typeof flat.y === "number" && typeof flat.yaw === "number") {
          newPose = {
            x:     flat.x as number,
            y:     flat.y as number,
            yaw:   flat.yaw as number,
            lat:   flat.lat as number | undefined,
            lon:   flat.lon as number | undefined,
            speed: flat.speed as number | undefined,
          };
        }
      }

      if (newPose) {
        setPose(newPose);
        clearPoseAfterTimeout();
      }
    });

    const unsubStatus = getWebSocket().onStatus((status) => {
      if (status === "disconnected") {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setPose(null);
      }
    });

    return () => {
      unsubMsg();
      unsubStatus();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return pose;
}
