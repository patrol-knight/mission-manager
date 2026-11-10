import styles from "./controls.module.css";

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
