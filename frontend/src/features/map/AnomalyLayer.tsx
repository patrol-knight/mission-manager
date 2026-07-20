import { useContext, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useDeviceStore, selectAnomalyList } from "../../stores/deviceStore";
import { xyToLngLat } from "../../api/mapApi";
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
  `;
  el.textContent = "!";
  el.title = anomaly.description ?? "Anomaly";
  if (anomaly.status !== "verified") {
    el.style.animation = "anomaly-pulse 1.4s ease-out infinite";
  }
  return el;
}

/** Display-only per plan §8.4 — anomaly markers aren't clickable; the
 * arrival-toast -> inspector flow is the intended interaction path. */
export function AnomalyLayer() {
  const { map } = useContext(MapContext);
  const anomalies = useDeviceStore(useShallow(selectAnomalyList));

  const options = useMemo<UseMarkerListOptions<Anomaly>>(
    () => ({
      keyOf: (a) => a.anomalyId,
      project: async (a) => {
        try {
          const { lat, lon } = await xyToLngLat(a.x, a.y, a.frameId);
          return { lng: lon, lat };
        } catch {
          return null;
        }
      },
      buildElement: buildAnomalyElement,
      updateElement: (el, a) => {
        el.style.animation = a.status !== "verified" ? "anomaly-pulse 1.4s ease-out infinite" : "";
      },
    }),
    [],
  );

  useMarkerList(map, anomalies, options);
  return null;
}
