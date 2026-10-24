import { useContext, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDeviceStore, selectDeviceList, selectAlertCounts } from "../../stores/deviceStore";
import { MapContext } from "../map/MapContext";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Note } from "../../components/ui/Note";
import { PillButton } from "../../components/ui/Pill";
import { cx } from "../../components/ui/cx";
import { useDeviceInspector } from "./useDeviceInspector";
import { sortTowers, visibleTiles } from "./towers";
import { deviceConnectivity, type DeviceConnectivity } from "./connectivity";
import { useApiConnection } from "../../hooks/useApiConnection";
import { StatusDot } from "../../components/ui/StatusDot";
import { useMapHighlightStore } from "../../stores/mapHighlightStore";
import type { Device } from "../../types/domain";
import styles from "./TowersCard.module.css";

/** Close enough that anomalies a meter apart separate on screen (~17 px/m). */
const TOWER_ZOOM = 21;
/** Tiles in the card, the "+N more" one included: two columns, three rows. */
const TILE_LIMIT = 6;

/** Towers in priority order, and what a row can do with one. */
function useTowers() {
  const towers = useDeviceStore(useShallow((s) => selectDeviceList(s).filter((d) => d.type === "iot")));
  const alertCounts = useDeviceStore(useShallow(selectAlertCounts));
  const { map } = useContext(MapContext);
  const { openInspector } = useDeviceInspector();
  const { status } = useApiConnection();
  // A row unmounted under the pointer (panel switched) never sees mouseleave.
  const setHoveredTower = useMapHighlightStore((s) => s.setHoveredTower);
  useEffect(() => () => setHoveredTower(null), [setHoveredTower]);

  const flyTo = (tower: Device) => {
    if (!map || tower.pose.lat == null || tower.pose.lon == null) return;
    map.flyTo({ center: [tower.pose.lon, tower.pose.lat], zoom: TOWER_ZOOM, duration: 800 });
  };

  return {
    towers: sortTowers(towers, alertCounts),
    connectivityOf: (tower: Device) => deviceConnectivity(tower, status === "connected"),
    flyTo,
    openInspector,
  };
}

/** One tower: a connection dot and its name (greyed when disconnected),
 * and "i", which opens its device window (camera,
 * open alerts, position). The row itself flies the map to the tower. */
function TowerRow({
  tower,
  connectivity,
  tile,
  onFlyTo,
  onInfo,
}: {
  tower: Device;
  connectivity: DeviceConnectivity;
  /** A tile in the card's grid rather than a row of the full list. */
  tile?: boolean;
  onFlyTo: () => void;
  onInfo: () => void;
}) {
  const name = tower.name ?? tower.deviceId;
  const online = connectivity.status === "online";
  const setHoveredTower = useMapHighlightStore((s) => s.setHoveredTower);
  return (
    <li
      className={cx(tile ? styles.tile : styles.item, !online && styles.offline)}
      // Rings the tower's marker on the map while the pointer is on its row.
      onMouseEnter={() => setHoveredTower(tower.deviceId)}
      onMouseLeave={() => setHoveredTower(null)}
    >
      <button
        type="button"
        className={styles.row}
        onClick={onFlyTo}
        data-hint="Show on map"
        aria-label={`${name}: ${connectivity.label}. Show on map`}
      >
        <StatusDot status={connectivity.status} />
        <span className={styles.name}>{name}</span>
      </button>
      <PillButton tone="subtle" className={styles.info} onClick={onInfo} hint="Open camera" aria-label={`Open ${name} camera`}>
        {/* Optically centred like the map markers' glyphs (index.css). */}
        <span className="marker-glyph">i</span>
      </PillButton>
    </li>
  );
}

/**
 * The towers as small tiles, two per row -- those with open alerts first,
 * offline ones last. Up to TILE_LIMIT fit; past that the last tile becomes
 * "+N more" and opens the full list (`onShowAll`).
 */
export function TowersCard({ onShowAll }: { onShowAll: () => void }) {
  const { towers, connectivityOf, flyTo, openInspector } = useTowers();
  const hasTowers = towers.length > 0;
  const { shown, hidden } = visibleTiles(towers.length, TILE_LIMIT);

  return (
    <Card title="IoT Towers">
      {!hasTowers ? (
        <Note>No towers connected</Note>
      ) : (
        <ul className={styles.grid}>
          {towers.slice(0, shown).map((tower) => (
            <TowerRow
              key={tower.deviceId}
              tower={tower}
              connectivity={connectivityOf(tower)}
              tile
              onFlyTo={() => flyTo(tower)}
              onInfo={() => openInspector(tower.deviceId)}
            />
          ))}
          {hidden > 0 && (
            <li className={cx(styles.tile, styles.moreTile)}>
              <button type="button" className={cx(styles.row, styles.more)} onClick={onShowAll}>
                +{hidden} more
              </button>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** The full tower list, for when the card can't show them all. */
export function TowersPanel({ onBack }: { onBack: () => void }) {
  const { towers, connectivityOf, flyTo, openInspector } = useTowers();

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
          {towers.map((tower) => (
            <TowerRow
              key={tower.deviceId}
              tower={tower}
              connectivity={connectivityOf(tower)}
              onFlyTo={() => flyTo(tower)}
              onInfo={() => openInspector(tower.deviceId)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
