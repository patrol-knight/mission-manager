import type { ReactNode } from "react";
import type { Level } from "./metrics";
import styles from "./DevPage.module.css";

export function Kpi({ label, value, unit, level, children }: {
  label: string;
  value: string;
  unit?: string;
  level?: Level;
  children?: ReactNode;
}) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={`${styles.kpiValue} ${level ? styles[level] : ""}`}>
        {value}
        {unit && value !== "–" && <span className={styles.kpiUnit}>{unit}</span>}
      </span>
      {children}
    </div>
  );
}
