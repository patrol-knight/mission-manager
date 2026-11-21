import { useMemo } from "react";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useDeviceStore, selectRobot } from "../../stores/deviceStore";
import { lineLengthM, remainingRoute, type LngLatPair } from "../map/geo";

/** Meters of the investigation route still ahead of the robot, rounded;
 * null unless it's en route. Distance, not an ETA: the robot's speed varies
 * (turns, obstacles), so a countdown would jump. */
export function useDistanceLeft(): number | null {
  const route = useInvestigationStore((s) => (s.investigation?.phase === "en_route" ? s.investigation.route : null));
  const lon = useDeviceStore((s) => selectRobot(s)?.pose?.lon ?? null);
  const lat = useDeviceStore((s) => selectRobot(s)?.pose?.lat ?? null);
  return useMemo(() => {
    if (!route || lon === null || lat === null) return null;
    const coords = route.geometry.coordinates as LngLatPair[];
    return Math.round(lineLengthM(remainingRoute(coords, [lon, lat])));
  }, [route, lon, lat]);
}
