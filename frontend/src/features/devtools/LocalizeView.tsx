import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import { lngLatToXy } from "../../api/mapApi";
import { Button } from "../../components/ui/Button";
import { StatusDot } from "../../components/ui/StatusDot";
import { useToast } from "../../components/useToast";
import { selectDeviceList, useDeviceStore } from "../../stores/deviceStore";
import { useShallow } from "zustand/react/shallow";
import { buildRobotElement } from "../devices/DeviceMarkerLayer";
import { headingDegrees, yawBetween } from "../map/geo";
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

interface PickedPoint {
  lng: number;
  lat: number;
  x: number;
  y: number;
}

/** The dragged arrow, in screen pixels: from the press toward the pointer,
 * growing up to MAX_ARROW_PX. */
function DragArrow({ drag: { start, current } }: { drag: Drag }) {
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
        stroke={mapPalette.poseArrow}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <polygon
        points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`}
        fill={mapPalette.poseArrow}
      />
      <circle
        cx={start.x}
        cy={start.y}
        r={6}
        fill={mapPalette.poseArrow}
        stroke={mapPalette.markerBorder}
        strokeWidth={2}
      />
    </svg>
  );
}

function buildPoint(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:14px;height:14px;border-radius:50%;pointer-events:none;background:${mapPalette.mapPoint};
    border:2px solid ${mapPalette.markerBorder};box-shadow:0 1px 3px rgba(0,0,0,0.4);`;
  return el;
}

/** One marker, shown at `at`, or hidden without it. */
function useSingleMarker(build: () => HTMLElement, at: { lng: number; lat: number } | null): void {
  const { map } = useContext(MapContext);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!map) return;
    const marker = new maplibregl.Marker({ element: build() });
    markerRef.current = marker;
    return () => {
      marker.remove();
    };
  }, [map, build]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (!at) {
      marker.remove();
      return;
    }
    marker.setLngLat([at.lng, at.lat]);
    // Only once: addTo() removes the marker first.
    if (!marker.getElement().isConnected) marker.addTo(map);
  }, [map, at]);
}

/** While active: the map is frozen, and a press and drag draws the arrow.
 * Releasing finishes it, anywhere on the page. */
function InitializeLayer({ active, onRelease }: { active: boolean; onRelease: (pose: Pose) => void }) {
  const { map } = useContext(MapContext);
  const [drag, setDrag] = useState<Drag | null>(null);
  const onReleaseRef = useRef(onRelease);
  useEffect(() => {
    onReleaseRef.current = onRelease;
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
      if (Math.hypot(end.x - start.x, end.y - start.y) >= MIN_DRAG_PX) {
        const from = map.unproject([start.x, start.y]);
        const yaw = yawBetween(from, map.unproject([end.x, end.y]));
        onReleaseRef.current({ lng: from.lng, lat: from.lat, yaw });
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

  return map && active && drag ? createPortal(<DragArrow drag={drag} />, map.getContainer()) : null;
}

/** While active, a click picks a point. The map still moves, to find the spot. */
function PickPointLayer({
  active,
  point,
  onPick,
}: {
  active: boolean;
  point: PickedPoint | null;
  onPick: (at: { lng: number; lat: number }) => void;
}) {
  const { map } = useContext(MapContext);
  useSingleMarker(buildPoint, point);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  });

  useEffect(() => {
    if (!map || !active) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    const click = (e: maplibregl.MapMouseEvent) => onPickRef.current({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on("click", click);
    return () => {
      map.off("click", click);
      canvas.style.cursor = "";
    };
  }, [map, active]);

  return null;
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
  const [point, setPoint] = useState<PickedPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { show } = useToast();

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

  const pick = (at: { lng: number; lat: number }) => {
    setMode("idle");
    lngLatToXy(at.lat, at.lng)
      .then(({ x, y }) => setPoint({ ...at, x, y }))
      .catch(report);
  };

  return (
    <div className={styles.layout}>
      <div className={styles.map}>
        <MapContext.Provider value={{ map, ready }}>
          <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
            <LaneletLayer />
            <RobotLayer robot={robot} />
            <InitializeLayer active={mode === "initialize"} onRelease={initialize} />
            <PickPointLayer active={mode === "pick"} point={point} onPick={pick} />
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
            disabled={!robot?.connected}
            onClick={() => toggle("initialize")}
          >
            {mode === "initialize" ? "Cancel" : "Initialize"}
          </Button>
        </section>

        <section className={styles.card}>
          <h3 className={styles.title}>Map point</h3>
          {point ? (
            <span className={styles.location}>
              {point.x.toFixed(2)}, {point.y.toFixed(2)}
            </span>
          ) : (
            <span className={styles.muted}>No point</span>
          )}
          <Button block onClick={() => toggle("pick")}>
            {mode === "pick" ? "Cancel" : "Pick point"}
          </Button>
        </section>

        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
}
