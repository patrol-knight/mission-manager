import devStyles from "../DevPage.module.css";
import { Slider, Toggle } from "./controls";
import { TYPES, VERDICTS, type HeatmapConfig, type Verdict } from "./heatmapApi";
import styles from "./Heatmap.module.css";

export function ConfigPanel({ config, onChange }: { config: HeatmapConfig; onChange: (config: HeatmapConfig) => void }) {
  const set = (patch: Partial<HeatmapConfig>) => onChange({ ...config, ...patch });
  const toggleConfidence = (verdict: Verdict, on: boolean) =>
    set({
      confidence_for: on
        ? [...config.confidence_for, verdict]
        : config.confidence_for.filter((v) => v !== verdict),
    });

  return (
    <>
      <section className={styles.section}>
        <h4 className={devStyles.sectionTitle}>Verdict weight</h4>
        {VERDICTS.map(([key, label, color]) => (
          <Slider
            key={key}
            label={label}
            swatch={color}
            min={0}
            max={1}
            step={0.05}
            value={config.verdict_weights[key]}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ verdict_weights: { ...config.verdict_weights, [key]: v } })}
          />
        ))}
      </section>

      <section className={styles.section}>
        <h4 className={devStyles.sectionTitle}>Scale by confidence</h4>
        <div className={styles.chips}>
          {VERDICTS.map(([key, label]) => {
            const on = config.confidence_for.includes(key);
            return (
              <label key={key} className={styles.chipToggle}>
                <Toggle on={on} label={`${label} by confidence`} onChange={(v) => toggleConfidence(key, v)} />
                {label}
              </label>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h4 className={devStyles.sectionTitle}>Type weight</h4>
        {TYPES.map(([key, label]) => (
          <Slider
            key={key}
            label={label}
            min={0}
            max={2}
            step={0.05}
            value={config.type_weights[key]}
            format={(v) => v.toFixed(2)}
            onChange={(v) => set({ type_weights: { ...config.type_weights, [key]: v } })}
          />
        ))}
      </section>

      <section className={styles.section}>
        <h4 className={devStyles.sectionTitle}>Time and space</h4>
        <Slider
          label="Half-life"
          min={0}
          max={60}
          step={0.5}
          value={config.half_life_days}
          format={(v) => (v ? `${v} days` : "Off")}
          onChange={(v) => set({ half_life_days: v })}
        />
        <Slider
          label="Bandwidth σ"
          min={1}
          max={15}
          step={0.5}
          value={config.bandwidth_m}
          format={(v) => `${v.toFixed(1)} m`}
          onChange={(v) => set({ bandwidth_m: v })}
        />
        <Slider
          label="Full color at"
          min={0.5}
          max={20}
          step={0.5}
          value={config.full_at}
          format={(v) => `${v} events`}
          onChange={(v) => set({ full_at: v })}
        />
      </section>
    </>
  );
}
