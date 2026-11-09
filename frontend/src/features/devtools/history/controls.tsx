import type { ReactNode } from "react";
import type { Estimate, VerdictCounts } from "./historyApi";
import { VERDICTS } from "./historyFormat";
import styles from "./History.module.css";


export function Segmented<T extends string>({
  options,
  value,
  onChange,
  full,
}: {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
  full?: boolean;
}) {
  return (
    <div className={`${styles.segmented} ${full ? styles.full : ""}`}>
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`${styles.segment} ${key === value ? styles.segmentActive : ""}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`${styles.toggle} ${on ? styles.toggleOn : ""}`}
      onClick={() => onChange(!on)}
    />
  );
}

export function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={styles.row}>
      <span>{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  swatch,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  swatch?: string;
}) {
  return (
    <label className={styles.slider}>
      <span className={styles.sliderHead}>
        <span>
          {swatch && <span className={styles.swatch} style={{ background: swatch }} />}
          {label}
        </span>
        <span className={styles.sliderValue}>{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function VerdictMix({ counts, total }: { counts: VerdictCounts; total: number }) {
  if (!total) return <span className={styles.small}>–</span>;
  return (
    <div className={styles.mix} title={VERDICTS.map(([k, label]) => `${label}  ${counts[k]}`).join("\n")}>
      <div className={styles.mixBar}>
        {VERDICTS.map(([k, , color]) =>
          counts[k] > 0 ? <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: color }} /> : null,
        )}
      </div>
      <div className={styles.mixLegend}>
        {VERDICTS.map(([k, label, color]) => (
          <span key={k}>
            <b style={{ color }}>{counts[k]}</b> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Interval({ estimate, color, n }: { estimate: Estimate; color: string; n: number }) {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div
      className={styles.interval}
      title={`${pct(estimate.mean)}  (90%: ${pct(estimate.low)}–${pct(estimate.high)})\nfrom ${n} alerts`}
    >
      <div className={styles.intervalTrack}>
        <span
          className={styles.intervalBand}
          style={{ left: pct(estimate.low), width: pct(estimate.high - estimate.low), background: color }}
        />
        <span className={styles.intervalMean} style={{ left: pct(estimate.mean) }} />
      </div>
      <span>{pct(estimate.mean)}</span>
    </div>
  );
}

export function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`${styles.field} ${wide ? styles.wide : ""}`}>
      {label}
      {children}
    </label>
  );
}
