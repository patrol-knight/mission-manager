import type { components } from "../../api/schema";
import { http } from "../../api/httpClient";

export type GeofenceSet = components["schemas"]["GeofenceSet-Output"];

export const geofenceApi = {
  get: () => http.get<GeofenceSet>("/api/geofences"),
  replace: (zones: GeofenceSet["zones"]) => http.put<GeofenceSet>("/api/geofences", { zones }),
};
