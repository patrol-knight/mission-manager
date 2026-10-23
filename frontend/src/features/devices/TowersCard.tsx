import { useContext, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore, selectDeviceList, selectAlertCounts } from "../../stores/deviceStore";
import { useApiConnection } from "../../hooks/useApiConnection";
import { MapContext } from "../map/MapContext";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Note } from "../../components/ui/Note";
import { Pill, type PillTone } from "../../components/ui/Pill";
import { StatusDot } from "../../components/ui/StatusDot";
import { cx } from "../../components/ui/cx";
import { deviceConnectivity, type DeviceConnectivity } from "./connectivity";
import { sortTowers, visibleTiles } from "./towers";
import type { Device } from "../../types/domain";
import styles from "./TowersCard.module.css";

/** Close enough that anomalies a meter apart separate on screen (~17 px/m). */
const TOWER_ZOOM = 21;
const TILE_HEIGHT = 34;
const TILE_GAP = 6;
const COLUMNS = 2;
/** Room kept under the grid inside the card (its bottom padding). */
const CARD_PADDING_BOTTOM = 16;

const CONNECTIVITY_TONE: Record<DeviceConnectivity["status"], PillTone> = {
  online: "success",
  offline: "danger",
  unknown: "muted",
};

const CONNECTIVITY_TEXT: Record<DeviceConnectivity["status"], string> = {
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
};

/** Towers in priority order, and how to show one on the map. */
function useTowers() {
  const towers = useDeviceStore(useShallow((s) => selectDeviceList(s).filter((d) => d.type === "iot")));
  const alertCounts = useDeviceStore(useShallow(selectAlertCounts));
  const { status } = useApiConnection();
  const { map } = useContext(MapContext);

  const flyTo = (tower: Device) => {
    if (!map || tower.pose.lat == null || tower.pose.lon == null) return;
    map.flyTo({ center: [tower.pose.lon, tower.pose.lat], zoom: TOWER_ZOOM, duration: 800 });
  };

  return {
    towers: sortTowers(towers, alertCounts),
    alertCounts,
    connectivityOf: (tower: Device) => deviceConnectivity(tower, status === "connected"),
    flyTo,
  };
}

/**
 * Every IoT tower as a compact tile -- open alerts first, then offline ones
 * -- in as many rows as fit above the panel's bottom edge, so the panel
 * never scrolls. When they don't all fit, the last tile becomes "+N more"
 * and opens the full list (`onShowAll`). A tile flies the map to its tower,
 * zoomed in far enough for its anomalies to stand apart; the tower's marker
 * on the map opens its camera.
 */
export function TowersCard({ onShowAll }: { onShowAll: () => void }) {
  const { towers, alertCounts, connectivityOf, flyTo } = useTowers();
  const gridRef = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(Infinity);
  const hasTowers = towers.length > 0;

  // Rows that fit between the grid's top and the bottom of the scrolling
  // panel section it sits in -- measured against the section, not the grid's
  // own (content-sized) height, so it grows back when the window does.
  useEffect(() => {
    const grid = gridRef.current;
    const section = grid?.closest<HTMLElement>("[data-fit-container]");
    if (!grid || !section) return;
    const measure = () => {
      const sectionBottom = section.getBoundingClientRect().bottom - parseFloat(getComputedStyle(section).paddingBottom);
      const room = sectionBottom - grid.getBoundingClientRect().top - CARD_PADDING_BOTTOM;
      const rows = Math.max(1, Math.floor((room + TILE_GAP) / (TILE_HEIGHT + TILE_GAP)));
      setCapacity(rows * COLUMNS);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    return () => observer.disconnect();
  }, [hasTowers]);

  const online = towers.filter((t) => connectivityOf(t).status === "online").length;
  const { shown, hidden } = visibleTiles(towers.length, capacity);

  return (
    <Card
      title="IoT Towers"
      aside={
        towers.length > 0 ? (
          <Pill tone={online === towers.length ? "success" : "neutral"}>
            {online}/{towers.length} online
          </Pill>
        ) : undefined
      }
    >
      {towers.length === 0 ? (
        <Note>No towers connected</Note>
      ) : (
        <div ref={gridRef} className={styles.grid}>
          {towers.slice(0, shown).map((tower) => {
            const connectivity = connectivityOf(tower);
            const alerts = alertCounts[tower.deviceId] ?? 0;
            const name = tower.name ?? tower.deviceId;
            return (
              <button
                key={tower.deviceId}
                type="button"
                className={cx(styles.tile, alerts > 0 && styles.alerting, connectivity.status !== "online" && styles.offline)}
                onClick={() => flyTo(tower)}
                title={`${name}: ${connectivity.label}${alerts > 0 ? `, ${alerts} open ${alerts === 1 ? "alert" : "alerts"}` : ""}. Show on the map`}
              >
                <StatusDot status={connectivity.status} role="status" aria-label={connectivity.label} />
                <span className={styles.name}>{name}</span>
                {alerts > 0 && <span className={styles.count}>{alerts}</span>}
              </button>
            );
          })}
          {hidden > 0 && (
            <button type="button" className={cx(styles.tile, styles.more)} onClick={onShowAll}>
              +{hidden} more
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

/** The full tower list, for when the card can't show them all. */
export function TowersPanel({ onBack }: { onBack: () => void }) {
  const { towers, alertCounts, connectivityOf, flyTo } = useTowers();

  return (
    <>
      <div className={styles.header}>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <h2 className={styles.title}>IoT Towers</h2>
        <span style={{ width: 60 }} />
      </div>
      {towers.length === 0 ? (
        <Note>No towers connected</Note>
      ) : (
        <ul className={styles.list}>
          {towers.map((tower) => {
            const connectivity = connectivityOf(tower);
            const alerts = alertCounts[tower.deviceId] ?? 0;
            return (
              <li key={tower.deviceId}>
                <button type="button" className={styles.row} onClick={() => flyTo(tower)}>
                  <span className={styles.name}>{tower.name ?? tower.deviceId}</span>
                  {alerts > 0 && (
                    <Pill tone="danger" dot>
                      {alerts} {alerts === 1 ? "alert" : "alerts"}
                    </Pill>
                  )}
                  <Pill tone={CONNECTIVITY_TONE[connectivity.status]}>{CONNECTIVITY_TEXT[connectivity.status]}</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
