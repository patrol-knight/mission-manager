import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useDeviceStore, selectAnomalyList } from "../../stores/deviceStore";
import type { Anomaly } from "../anomalies/anomalyTypes";

function buildAnomalyElement(anomaly: Anomaly): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:22px;height:22px;border-radius:50%;
    background:#e03131;
    border:2px solid white;
    box-shadow:0 1px 5px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    color:white;font-size:12px;font-weight:bold;
    animation: anomaly-pulse 1.4s ease-out infinite;
    z-index:2;
  `;
  el.textContent = "!";
  el.title = `${anomaly.types.join(", ")} (${Math.round(anomaly.confidence * 100)}%)`;
  return el;
}

/** Display-only — anomaly markers aren't clickable; the
 * arrival-toast -> verify-window flow is the intended interaction path.
 * Resolved anomalies ("verified" covers both Verify and Dismiss -- see
 * backend AnomalyRegistry._resolve's docstring) drop off the map entirely
 * rather than sitting there unpulsing -- once resolved, there's nothing
 * left to look at. */
export function AnomalyLayer() {
  const { map } = useContext(MapContext);
  const anomalies = useDeviceStore(useShallow((s) => selectAnomalyList(s).filter((a) => a.status !== "verified")));

  const options = useMemo<UseMarkerListOptions<Anomaly>>(
    () => ({
      keyOf: (a) => a.anomalyId,
      dependsOn: (a) => [a.lat, a.lon],
      // Computed once, server-side, at Zenoh ingest time (see
      // backend/models/anomaly.py::Anomaly.lat/lon) -- no xy-to-lnglat call.
      project: async (a) => (a.lat != null && a.lon != null ? { lng: a.lon, lat: a.lat } : null),
      buildElement: buildAnomalyElement,
    }),
    [],
  );

  useMarkerList(map, anomalies, options);
  return null;
}
