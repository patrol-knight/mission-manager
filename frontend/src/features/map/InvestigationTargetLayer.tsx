import { useContext, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useInvestigationStore } from "../../stores/investigationStore";
import type { InvestigationTarget } from "../investigation/investigationTypes";
import { mapPalette } from "./mapPalette";

interface Stop extends InvestigationTarget {
  /** A picked Explore point's stop, before the robot is sent. */
  proposed: boolean;
}

function buildTargetElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:10px;height:10px;border-radius:50%;box-sizing:border-box;
    background:${mapPalette.markerBorder};
    border:2px solid ${mapPalette.investigationEdge};
    z-index:3;
  `;
  return el;
}

/** Where the robot stops: the end of the investigation route, a small
 * white dot -- not a second destination next to the yellow target it looks
 * at. Gone once the robot is there. For a picked Explore point it shows
 * before the robot is sent, ringed grey, since the point may be off the
 * lanes. */
export function InvestigationTargetLayer() {
  const { map } = useContext(MapContext);
  const target = useInvestigationStore((s) =>
    s.investigation && s.investigation.phase !== "on_site" ? s.investigation.target : null,
  );
  const proposed = useInvestigationStore((s) => s.picked?.preview?.target ?? null);
  const stops = useMemo<Stop[]>(
    () => (target ? [{ ...target, proposed: false }] : proposed ? [{ ...proposed, proposed: true }] : []),
    [target, proposed],
  );

  const options = useMemo<UseMarkerListOptions<Stop>>(
    () => ({
      keyOf: () => "investigation-target",
      dependsOn: (t) => [t.lat, t.lon],
      project: async (t) => (t.lat != null && t.lon != null ? { lng: t.lon, lat: t.lat } : null),
      buildElement: buildTargetElement,
      updateElement: (el, t) => {
        el.style.borderColor = t.proposed ? mapPalette.explorePick : mapPalette.investigationEdge;
      },
    }),
    [],
  );

  useMarkerList(map, stops, options, [stops]);
  return null;
}
