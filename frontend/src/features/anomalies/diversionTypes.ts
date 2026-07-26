/** Robot diversion to investigate an anomaly -- see backend
 * core/anomaly_response.py. "none" until anomaly.diversion.started fires;
 * "outbound" while the robot heads to the anomaly; "returning" after the
 * operator verifies/dismisses, until anomaly.diversion.cleared fires. The
 * mission route (CurrentMissionRouteLayer) grays out for both non-"none"
 * phases; DiversionRouteLayer renders `route` in yellow for both. */
export type DiversionPhase = "none" | "outbound" | "returning";

export interface Diversion {
  phase: DiversionPhase;
  anomalyId: string | null;
  route: GeoJSON.Feature<GeoJSON.LineString> | null;
  /** Outbound leg's target (the anomaly's snapped lanelet point) -- null
   * outside the "outbound" phase. Lets DiversionTargetMarkerLayer show a
   * marker at exactly where the robot is headed, not just the route line.
   * lat/lon computed once server-side (MapServer.snap_to_lanelet), same as
   * device/anomaly/waypoint positions -- no xy-to-lnglat call needed. */
  target: { x: number; y: number; frameId: string; lat: number | null; lon: number | null } | null;
  /** Returning leg's target waypoint id -- null outside the "returning"
   * phase. DiversionReturning only carries an id, not x/y, so consumers
   * resolve it against the current mission definition's waypoints. */
  targetWaypointId: string | null;
}

export const NO_DIVERSION: Diversion = {
  phase: "none",
  anomalyId: null,
  route: null,
  target: null,
  targetWaypointId: null,
};

/** Wire shape -- see backend/models/anomaly_response.py::DiversionStarted. */
export interface RawDiversionStarted {
  anomaly_id: string;
  robot_device_id: string;
  route: GeoJSON.Feature<GeoJSON.LineString>;
  target: { x: number; y: number; frame_id: string; lanelet_id: number | null; lat: number | null; lon: number | null };
  started_at: string;
}

/** Wire shape -- see backend/models/anomaly_response.py::DiversionReturning. */
export interface RawDiversionReturning {
  anomaly_id: string;
  robot_device_id: string;
  route: GeoJSON.Feature<GeoJSON.LineString>;
  target_waypoint_id: string;
  started_at: string;
}

/** Wire shape -- see backend/core/anomaly_response.py's cleared broadcasts. */
export interface RawDiversionCleared {
  anomaly_id: string;
  reason: string;
}
