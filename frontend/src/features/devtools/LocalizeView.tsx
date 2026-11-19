import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import { lngLatToXy } from "../../api/mapApi";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { useToast } from "../../components/useToast";
import { selectDeviceList, useDeviceStore } from "../../stores/deviceStore";
import { useShallow } from "zustand/react/shallow";
import { buildRobotElement } from "../devices/deviceMarker";
import { GeofenceCard } from "../geofences/GeofenceCard";
import { GeofenceLayer } from "../geofences/GeofenceLayer";
import { useGeofenceEditor } from "../geofences/useGeofenceEditor";
import { headingDegrees, yawBetween } from "../map/geo";
import { copyText } from "../../utils/copyText";
import { LaneletLayer } from "../map/LaneletLayer";
import { MapContext } from "../map/MapContext";
import { useMarkerList, type UseMarkerListOptions } from "../map/mapMarkers";
import { mapPalette } from "../map/mapPalette";
import { MapWorkspace } from "../map/MapWorkspace";
import { useMapInstance } from "../map/useMapInstance";
import type { Device } from "../../types/domain";
import { devApi } from "./devApi";
import styles from "./LocalizeView.module.css";

/** A press that moves less than this is a click: nothing to send. */
const MIN_DRAG_PX = 8;
const MAX_ARROW_PX = 60;
const ARROW_HEAD_PX = 18;
const ARROW_HEAD_ANGLE = Math.PI / 6;

type Mode = "idle" | "initialize" | "pick";

interface ScreenPoint {
  x: number;
  y: number;
}

interface Drag {
  start: ScreenPoint;
  current: ScreenPoint;
}

interface Pose {
  lng: number;
  lat: number;
  yaw: number;
}

interface PickedPose {
  lng: number;
  lat: number;
  x: number;
  y: number;
  yaw: number | null;
}

/** The dragged arrow, in screen pixels: from the press toward the pointer,
 * growing up to MAX_ARROW_PX. */
function DragArrow({ drag: { start, current }, color }: { drag: Drag; color: string }) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < MIN_DRAG_PX) return null;

  const angle = Math.atan2(dy, dx);
  const along = (from: ScreenPoint, distance: number, direction: number) => ({
    x: from.x + distance * Math.cos(direction),
    y: from.y + distance * Math.sin(direction),
  });
  const tip = along(start, Math.min(length, MAX_ARROW_PX), angle);
  const left = along(tip, -ARROW_HEAD_PX, angle - ARROW_HEAD_ANGLE);
  const right = along(tip, -ARROW_HEAD_PX, angle + ARROW_HEAD_ANGLE);

  return (
    <svg className={styles.arrow}>
      <line
        x1={start.x}
        y1={start.y}
        x2={tip.x}
        y2={tip.y}
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <polygon
        points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={color}
      />
      <circle
        cx={start.x}
        cy={start.y}
        r={6}
        fill={color}
        stroke={mapPalette.markerBorder}
        strokeWidth={2}
      />
    </svg>
  );
}

function buildPose(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = "width:36px;height:36px;pointer-events:none;";
  el.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 36 36" style="display:block;overflow:visible">
      <path data-heading d="M18 1 L24 12 L12 12 Z" fill="${mapPalette.mapPoint}" stroke="${mapPalette.markerBorder}"
        stroke-width="1.5" stroke-linejoin="round" />
      <circle cx="18" cy="18" r="6" fill="${mapPalette.mapPoint}" stroke="${mapPalette.markerBorder}" stroke-width="2" />
    </svg>`;
  return el;
}

function PickedPoseMarker({ pose }: { pose: PickedPose | null }) {
  const { map } = useContext(MapContext);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    const marker = new maplibregl.Marker({ element: buildPose(), rotationAlignment: "map" });
    markerRef.current = marker;
    return () => {
      marker.remove();
    };
  }, [map]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (!pose) {
      marker.remove();
      return;
    }
    const pointer = marker.getElement().querySelector<SVGElement>("[data-heading]");
    if (pointer) pointer.style.display = pose.yaw === null ? "none" : "";
    marker.setRotation(pose.yaw === null ? 0 : headingDegrees(pose.yaw));
    marker.setLngLat([pose.lng, pose.lat]);
    // Only once: addTo() removes the marker first.
    if (!marker.getElement().isConnected) marker.addTo(map);
  }, [map, pose]);

  return null;
}

/** While active: the map is frozen, and a press and drag draws the arrow.
 * Releasing finishes it, anywhere on the page; a press without a drag is a click. */
function PoseDragLayer({
  active,
  color,
  onRelease,
  onClick,
}: {
  active: boolean;
  color: string;
  onRelease: (pose: Pose) => void;
  onClick?: (at: { lng: number; lat: number }) => void;
}) {
  const { map } = useContext(MapContext);
  const [drag, setDrag] = useState<Drag | null>(null);
  const onReleaseRef = useRef(onRelease);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onReleaseRef.current = onRelease;
    onClickRef.current = onClick;
  });

  useEffect(() => {
    if (!map || !active) return;
    const controls = [
      map.dragPan,
      map.dragRotate,
      map.scrollZoom,
      map.boxZoom,
      map.doubleClickZoom,
      map.keyboard,
      map.touchZoomRotate,
    ];
    controls.forEach((control) => control.disable());
    const canvas = map.getCanvas();
    const container = map.getCanvasContainer();
    canvas.style.cursor = "crosshair";
    container.style.touchAction = "none";

    let start: ScreenPoint | null = null;
    const pointAt = (e: PointerEvent): ScreenPoint => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const down = (e: PointerEvent) => {
      start = pointAt(e);
      setDrag({ start, current: start });
    };
    const move = (e: PointerEvent) => {
      if (start) setDrag({ start, current: pointAt(e) });
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      const end = pointAt(e);
      const from = map.unproject([start.x, start.y]);
      if (Math.hypot(end.x - start.x, end.y - start.y) >= MIN_DRAG_PX) {
        const yaw = yawBetween(from, map.unproject([end.x, end.y]));
        onReleaseRef.current({ lng: from.lng, lat: from.lat, yaw });
      } else {
        onClickRef.current?.({ lng: from.lng, lat: from.lat });
      }
      start = null;
      setDrag(null);
    };

    container.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      container.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.style.cursor = "";
      container.style.touchAction = "";
      controls.forEach((control) => control.enable());
    };
  }, [map, active]);

  return map && active && drag ? createPortal(<DragArrow drag={drag} color={color} />, map.getContainer()) : null;
}

/** The robot's pose, as on the main map. Without one, no marker. */
function RobotLayer({ robot }: { robot: Device | null }) {
  const { map } = useContext(MapContext);
  const robots = useMemo(() => (robot?.pose ? [robot] : []), [robot]);
  const options = useMemo<UseMarkerListOptions<Device>>(
    () => ({
      keyOf: (d) => d.deviceId,
      dependsOn: (d) => [d.pose?.lat, d.pose?.lon],
      project: async (d) => (d.pose?.lat != null && d.pose.lon != null ? { lng: d.pose.lon, lat: d.pose.lat } : null),
      buildElement: buildRobotElement,
      rotationOf: (d) => headingDegrees(d.pose?.yaw ?? 0),
    }),
    [],
  );
  useMarkerList(map, robots, options);
  return null;
}

/** Sets the robot's initial pose by hand, for when GNSS can't, and reads
 * map-frame coordinates off the map. */
export function LocalizeView() {
  const devices = useDeviceStore(useShallow(selectDeviceList));
  const robot = devices.find((d) => d.type === "robot" && d.connected) ?? devices.find((d) => d.type === "robot") ?? null;
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useMapInstance(containerRef);
  const [mode, setMode] = useState<Mode>("idle");
  const [pose, setPose] = useState<PickedPose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();
  const geofences = useGeofenceEditor();
  const editingGeofences = geofences.state.draft !== null;

  const report = (err: unknown) => setError(err instanceof Error ? err.message : "Request failed");

  const toggle = (next: Mode) => {
    setError(null);
    setMode(mode === next ? "idle" : next);
  };

  const initialize = (released: Pose) => {
    setMode("idle");
    devApi
      .setInitialPose(released.lat, released.lng, released.yaw)
      .then(() => show("success", "Initial pose sent", `Yaw ${((released.yaw * 180) / Math.PI).toFixed(1)}°`))
      .catch(report);
  };

  const pick = (at: { lng: number; lat: number; yaw?: number }) => {
    setMode("idle");
    lngLatToXy(at.lat, at.lng)
      .then(({ x, y }) => setPose({ lng: at.lng, lat: at.lat, x, y, yaw: at.yaw ?? null }))
      .catch(report);
  };

  const copy = (picked: PickedPose) => {
    const lines = [`x: ${picked.x.toFixed(2)}`, `y: ${picked.y.toFixed(2)}`];
    if (picked.yaw !== null) lines.push(`yaw: ${picked.yaw.toFixed(4)}`);
    void copyText(lines.join("\n")).then((ok) =>
      ok ? show("success", "Copied", "Paste into the tower's zenoh_bridge.yaml") : show("error", "Clipboard unavailable"),
    );
  };

  return (
    <div className={styles.layout}>
      <div className={styles.map}>
        <MapContext.Provider value={{ map, ready }}>
          <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
            <LaneletLayer />
            <GeofenceLayer editor={geofences} />
            <RobotLayer robot={robot} />
            <PoseDragLayer active={mode === "initialize"} color={mapPalette.poseArrow} onRelease={initialize} />
            <PoseDragLayer active={mode === "pick"} color={mapPalette.mapPoint} onRelease={pick} onClick={pick} />
            <PickedPoseMarker pose={pose} />
          </MapWorkspace>
        </MapContext.Provider>
      </div>

      <div className={styles.cards}>
        <section className={styles.card}>
          <div className={styles.header}>
            <StatusDot status={robot?.connected ? "online" : "offline"} size={8} />
            <h3 className={styles.title}>{robot ? robot.deviceId : "No robot"}</h3>
          </div>
          {robot?.pose ? (
            <span className={styles.location}>
              {robot.pose.x.toFixed(2)}, {robot.pose.y.toFixed(2)}
            </span>
          ) : (
            <span className={styles.muted}>No location</span>
          )}
          <Button
            variant={mode === "initialize" ? "secondary" : "primary"}
            block
            disabled={!robot?.connected || editingGeofences}
            onClick={() => toggle("initialize")}
          >
            {mode === "initialize" ? "Cancel" : "Initialize"}
          </Button>
        </section>

        <section className={styles.card}>
          <h3 className={styles.title}>Map pose</h3>
          {pose ? (
            <>
              <span className={styles.location}>
                {pose.x.toFixed(2)}, {pose.y.toFixed(2)}
              </span>
              <span className={styles.location}>
                {pose.yaw === null
                  ? "No heading"
                  : `yaw ${pose.yaw.toFixed(4)} rad (${((pose.yaw * 180) / Math.PI).toFixed(1)}°)`}
              </span>
            </>
          ) : (
            <span className={styles.muted}>{mode === "pick" ? "Drag for heading, click for a point" : "No pose"}</span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button block disabled={editingGeofences} onClick={() => toggle("pick")}>
              {mode === "pick" ? "Cancel" : "Pick pose"}
            </Button>
            {pose && <Button onClick={() => copy(pose)}>Copy</Button>}
          </div>
        </section>

        <GeofenceCard editor={geofences} disabled={mode !== "idle"} />

        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
}
