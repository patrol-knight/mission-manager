import { createContext } from "react";
import type * as maplibregl from "maplibre-gl";

export interface MapContextValue {
  map: maplibregl.Map | null;
  ready: boolean;
}

export const MapContext = createContext<MapContextValue>({ map: null, ready: false });
