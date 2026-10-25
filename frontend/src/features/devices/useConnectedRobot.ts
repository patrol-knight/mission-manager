import { useApiConnection } from "../../hooks/useApiConnection";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import type { Device } from "../../types/domain";

/** The robot, if it is connected right now. With the backend disconnected
 * the robot's own `connected` flag is stale, so that counts as offline too.
 * Without a connected robot only mission editing is possible. */
export function useConnectedRobot(): Device | null {
  const robot = useDeviceStore(selectRobot);
  const { status } = useApiConnection();
  return status === "connected" && robot?.connected ? robot : null;
}
