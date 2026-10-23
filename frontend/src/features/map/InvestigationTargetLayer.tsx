import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useInvestigationStore } from "../../stores/investigationStore";
import type { InvestigationTarget } from "../investigation/investigationTypes";
import { mapPalette } from "./mapPalette";

function buildTargetElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:20px;height:20px;border-radius:50%;
    background:${mapPalette.investigation};
    border:2px solid ${mapPalette.markerBorder};
    box-shadow:${mapPalette.markerShadow};
    animation: investigation-target-pulse 1.4s ease-out infinite;
    z-index:3;
  `;
  return el;
}

/** Yellow marker where the robot is actually headed: the anomaly's position
 * snapped to the lanelet network (lat/lon computed server-side). */
export function InvestigationTargetLayer() {
  const { map } = useContext(MapContext);
  const target = useInvestigationStore((s) => s.investigation?.target ?? null);
  const targets = useMemo(() => (target ? [target] : []), [target]);

  const options = useMemo<UseMarkerListOptions<InvestigationTarget>>(
    () => ({
      keyOf: () => "investigation-target",
      dependsOn: (t) => [t.lat, t.lon],
      project: async (t) => (t.lat != null && t.lon != null ? { lng: t.lon, lat: t.lat } : null),
      buildElement: buildTargetElement,
    }),
    [],
  );

  useMarkerList(map, targets, options);
  return null;
}
