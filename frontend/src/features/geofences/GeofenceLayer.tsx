import { useContext, useEffect, useMemo } from "react";
import type * as maplibregl from "maplibre-gl";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { mapPalette } from "../map/mapPalette";
import { MIN_ZONE_POINTS, shownZones, type GeofencePoint, type GeofenceZone } from "./geofenceEditorReducer";
import type { GeofenceEditor } from "./useGeofenceEditor";

const SOURCE_ID = "geofences";
const FILL_ID = "geofences-fill";
const LINE_ID = "geofences-line";
const HANDLE_CLASS = "geofence-handle";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface EdgeMidpoint {
  id: string;
  afterId: string;
  lat: number;
  lng: number;
}

function zoneFeature(zone: GeofenceZone, selected: boolean): GeoJSON.Feature | null {
  const ring = zone.points.map((point) => [point.lng, point.lat]);
  const properties = { selected };
  if (ring.length >= MIN_ZONE_POINTS) {
    return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } };
  }
  return ring.length === 2 ? { type: "Feature", properties, geometry: { type: "LineString", coordinates: ring } } : null;
}

function edgeMidpoints(points: GeofencePoint[]): EdgeMidpoint[] {
  if (points.length < MIN_ZONE_POINTS) return [];
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return {
      id: `${point.id}-${next.id}`,
      afterId: point.id,
      lat: (point.lat + next.lat) / 2,
      lng: (point.lng + next.lng) / 2,
    };
  });
}

function buildHandle(size: number, background: string): HTMLElement {
  const el = document.createElement("div");
  el.className = HANDLE_CLASS;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;box-sizing:border-box;cursor:pointer;
    background:${background};border:2px solid ${mapPalette.markerBorder};box-shadow:${mapPalette.markerShadow};`;
  return el;
}

/** The zones on the map. While editing: click the map to add a point, drag a
 * point to move it, click one to select it, drag an edge's small dot to insert
 * a point there. */
export function GeofenceLayer({ editor: { state, dispatch } }: { editor: GeofenceEditor }) {
  const { map } = useContext(MapContext);
  const editing = state.draft !== null;
  const zones = shownZones(state);
  const selectedZone = editing ? zones.find((zone) => zone.zoneId === state.selectedZoneId) : undefined;
  const points = useMemo(() => selectedZone?.points ?? [], [selectedZone]);
  const midpoints = useMemo(() => edgeMidpoints(points), [points]);

  const shapes = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: zones.flatMap((zone) => zoneFeature(zone, zone === selectedZone) ?? []),
    }),
    [zones, selectedZone],
  );

  useEffect(() => {
    if (!map) return;
    map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY });
    map.addLayer({
      id: FILL_ID,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": ["case", ["get", "selected"], mapPalette.geofenceFillSelected, mapPalette.geofenceFill],
      },
    });
    map.addLayer({
      id: LINE_ID,
      type: "line",
      source: SOURCE_ID,
      paint: { "line-color": mapPalette.anomaly, "line-width": ["case", ["get", "selected"], 3, 1.5] },
    });
    return () => {
      [LINE_ID, FILL_ID].forEach((id) => map.getLayer(id) && map.removeLayer(id));
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  useEffect(() => {
    (map?.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(shapes);
  }, [map, shapes]);

  const pointOptions = useMemo<UseMarkerListOptions<GeofencePoint>>(
    () => ({
      keyOf: (point) => point.id,
      project: async (point) => ({ lng: point.lng, lat: point.lat }),
      buildElement: () => buildHandle(16, mapPalette.edit),
      updateElement: (el, point) => {
        el.style.background = point.id === state.selectedPointId ? mapPalette.anomaly : mapPalette.edit;
      },
      draggable: () => true,
      onDragEnd: (point, { lat, lng }) => dispatch({ type: "MOVE_POINT", id: point.id, lat, lng }),
      onClick: (point) => dispatch({ type: "SELECT_POINT", id: point.id }),
    }),
    [state.selectedPointId, dispatch],
  );
  useMarkerList(map, points, pointOptions, [state.selectedPointId]);

  const midpointOptions = useMemo<UseMarkerListOptions<EdgeMidpoint>>(
    () => ({
      keyOf: (midpoint) => midpoint.id,
      project: async (midpoint) => ({ lng: midpoint.lng, lat: midpoint.lat }),
      buildElement: () => buildHandle(10, mapPalette.geofenceMidpoint),
      draggable: () => true,
      onDragEnd: (midpoint, { lat, lng }) => dispatch({ type: "INSERT_POINT", afterId: midpoint.afterId, lat, lng }),
      onClick: () => undefined, // Only so a click on it doesn't add a point underneath.
    }),
    [dispatch],
  );
  useMarkerList(map, midpoints, midpointOptions);

  useEffect(() => {
    if (!map || !editing) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if ((e.originalEvent.target as HTMLElement).closest(`.${HANDLE_CLASS}`)) return;
      dispatch({ type: "ADD_POINT", lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
      canvas.style.cursor = "";
    };
  }, [map, editing, dispatch]);

  return null;
}
