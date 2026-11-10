import { Button } from "../../../components/ui/Button";
import devStyles from "../DevPage.module.css";
import { Slider, Toggle } from "./controls";
import { TYPES, VERDICTS, type BaselineSpec, type HeatmapPreview, type Hotspot } from "./heatmapApi";
import styles from "./Heatmap.module.css";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Level({ level, after }: { level: number; after: number }) {
  const saturated = level >= 0.85;
  return (
    <div className={styles.level}>
      <div className={styles.levelTrack}>
        <span className={styles.levelAfter} style={{ width: pct(Math.min(after, 1)) }} />
        <span className={styles.levelNow} style={{ width: pct(Math.min(level, 1)) }} />
      </div>
      <span className={saturated ? devStyles.bad : undefined}>
        {pct(level)} → {pct(after)} with one true
      </span>
    </div>
  );
}

function HotspotCard({
  hotspot,
  level,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  hotspot: Hotspot;
  level: HeatmapPreview["hotspots"][number] | undefined;
  selected: boolean;
  onSelect: () => void;
  onChange: (hotspot: Hotspot) => void;
  onRemove: () => void;
}) {
  const set = (patch: Partial<Hotspot>) => onChange({ ...hotspot, ...patch });
  const total = VERDICTS.reduce((sum, [k]) => sum + hotspot.verdicts[k], 0) || 1;
  const toggleType = (type: Hotspot["types"][number], on: boolean) => {
    const types = on ? [...hotspot.types, type] : hotspot.types.filter((t) => t !== type);
    if (types.length) set({ types });
  };

  return (
    <div className={`${styles.hotspot} ${selected ? styles.hotspotSelected : ""}`} onClick={onSelect}>
      <div className={styles.row}>
        <input
          className={styles.labelInput}
          value={hotspot.name}
          maxLength={80}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      {level && <Level level={level.level} after={level.level_after_true} />}
      {selected && (
        <>
          <Slider
            label="Events per day"
            min={0}
            max={5}
            step={0.1}
            value={hotspot.per_day}
            format={(v) => v.toFixed(1)}
            onChange={(v) => set({ per_day: v })}
          />
          <Slider
            label="Radius"
            min={0}
            max={10}
            step={0.5}
            value={hotspot.radius_m}
            format={(v) => `${v} m`}
            onChange={(v) => set({ radius_m: v })}
          />
          {VERDICTS.map(([key, label, color]) => (
            <Slider
              key={key}
              label={label}
              swatch={color}
              min={0}
              max={1}
              step={0.05}
              value={hotspot.verdicts[key]}
              format={() => pct(hotspot.verdicts[key] / total)}
              onChange={(v) => set({ verdicts: { ...hotspot.verdicts, [key]: v } })}
            />
          ))}
          <div className={styles.chips}>
            {TYPES.map(([key, label]) => (
              <label key={key} className={styles.chipToggle}>
                <Toggle on={hotspot.types.includes(key)} label={label} onChange={(on) => toggleType(key, on)} />
                {label}
              </label>
            ))}
          </div>
          <Slider
            label="Confidence from"
            min={0}
            max={1}
            step={0.05}
            value={hotspot.confidence.low}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ confidence: { low: v, high: Math.max(v, hotspot.confidence.high) } })}
          />
          <Slider
            label="Confidence to"
            min={0}
            max={1}
            step={0.05}
            value={hotspot.confidence.high}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ confidence: { low: Math.min(v, hotspot.confidence.low), high: v } })}
          />
        </>
      )}
    </div>
  );
}

export function BaselinePanel({
  spec,
  preview,
  selected,
  adding,
  onSelect,
  onChange,
  onAdd,
}: {
  spec: BaselineSpec;
  preview: HeatmapPreview | null;
  selected: number | null;
  adding: boolean;
  onSelect: (index: number | null) => void;
  onChange: (spec: BaselineSpec) => void;
  onAdd: () => void;
}) {
  const set = (patch: Partial<BaselineSpec>) => onChange({ ...spec, ...patch });
  const setHotspot = (index: number, hotspot: Hotspot) =>
    set({ hotspots: spec.hotspots.map((h, i) => (i === index ? hotspot : h)) });
  const remove = (index: number) => {
    onSelect(null);
    set({ hotspots: spec.hotspots.filter((_, i) => i !== index) });
  };

  return (
    <>
      <section className={styles.section}>
        <h4 className={devStyles.sectionTitle}>Simulation</h4>
        <Slider
          label="History"
          min={1}
          max={90}
          step={1}
          value={spec.days}
          format={(v) => `${v} days`}
          onChange={(v) => set({ days: v })}
        />
        <Slider
          label="Background along lanes"
          min={0}
          max={10}
          step={0.1}
          value={spec.background.per_day}
          format={(v) => `${v.toFixed(1)} / day`}
          onChange={(v) => set({ background: { ...spec.background, per_day: v } })}
        />
        <div className={styles.row}>
          <span>Seed {spec.seed}</span>
          <Button size="sm" onClick={() => set({ seed: Math.floor(Math.random() * 10000) })}>
            New draw
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.row}>
          <h4 className={devStyles.sectionTitle}>Hotspots</h4>
          <Button size="sm" variant={adding ? "primary" : "secondary"} onClick={onAdd}>
            {adding ? "Click the map…" : "Add"}
          </Button>
        </div>
        {spec.hotspots.length === 0 && <span className={devStyles.muted}>No hotspots yet.</span>}
        {spec.hotspots.map((hotspot, i) => (
          <HotspotCard
            key={i}
            hotspot={hotspot}
            level={preview?.hotspots[i]}
            selected={selected === i}
            onSelect={() => onSelect(i)}
            onChange={(h) => setHotspot(i, h)}
            onRemove={() => remove(i)}
          />
        ))}
        <span className={styles.hint}>Drag a hotspot's circle on the map to move it.</span>
      </section>
    </>
  );
}
