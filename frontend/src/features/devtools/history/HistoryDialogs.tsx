import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { Field } from "./controls";
import { errorText } from "./historyFormat";
import { historyApi, type Source } from "./historyApi";
import styles from "./History.module.css";

function DialogForm<T>({
  title,
  text,
  confirmLabel,
  danger,
  wide,
  onSubmit,
  onDone,
  onCancel,
  children,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  danger?: boolean;
  wide?: boolean;
  onSubmit: (form: FormData) => Promise<T>;
  onDone: (result: T) => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    onSubmit(new FormData(e.currentTarget))
      .then(onDone)
      .catch((err: unknown) => {
        setError(errorText(err));
        setBusy(false);
      });
  };

  return (
    <Modal label={title} onClose={onCancel}>
      <form
        onSubmit={submit}
        style={{ display: "flex", flexDirection: "column", gap: 14, width: wide ? "min(720px, 85vw)" : "min(440px, 85vw)" }}
      >
        <div className={styles.dialogTitle}>{title}</div>
        <div className={styles.dialogText}>{text}</div>
        {children && <div className={styles.form}>{children}</div>}
        {error && <div style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)" }}>{error}</div>}
        <div className={styles.dialogActions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant={danger ? "dangerSolid" : "primary"} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SourceSelect() {
  return (
    <select className={styles.select} name="source" defaultValue="sim">
      <option value="sim">Sim</option>
      <option value="real">Real</option>
    </select>
  );
}

function NumberInput(props: { name: string; defaultValue: number; min: number; max?: number; step?: number }) {
  return <input className={styles.input} type="number" required {...props} />;
}

interface DialogProps {
  onDone: (message: string) => void;
  onCancel: () => void;
}

export function SeedDialog({ onDone, onCancel }: DialogProps) {
  return (
    <DialogForm
      title="Seed dummy data"
      text="Synthetic sessions on the current map: a few hotspots over a sparse background of false alarms."
      confirmLabel="Seed"
      onCancel={onCancel}
      onSubmit={(form) =>
        historyApi.seed({
          source: form.get("source") as Source,
          sessions: Number(form.get("sessions")),
          anomalies_per_session: Number(form.get("anomalies_per_session")),
          days: Number(form.get("days")),
          hotspots: Number(form.get("hotspots")),
          hotspot_share: Number(form.get("hotspot_share")),
        })
      }
      onDone={(r) => onDone(`Seeded ${r.sessions} sessions · ${r.anomalies} anomalies`)}
    >
      <Field label="Sessions">
        <NumberInput name="sessions" defaultValue={6} min={1} max={50} />
      </Field>
      <Field label="Anomalies per session">
        <NumberInput name="anomalies_per_session" defaultValue={40} min={1} max={1000} />
      </Field>
      <Field label="Spread over (days)">
        <NumberInput name="days" defaultValue={45} min={1} max={365} />
      </Field>
      <Field label="Hotspots">
        <NumberInput name="hotspots" defaultValue={4} min={1} max={20} />
      </Field>
      <Field label="Hotspot share">
        <NumberInput name="hotspot_share" defaultValue={0.65} min={0} max={1} step={0.05} />
      </Field>
      <Field label="Source">
        <SourceSelect />
      </Field>
    </DialogForm>
  );
}

export function PurgeDialog({ onDone, onCancel }: DialogProps) {
  return (
    <DialogForm
      title="Purge old history"
      text="Deletes anomalies closed before the cutoff, then sessions left empty. This can't be undone."
      confirmLabel="Purge"
      danger
      onCancel={onCancel}
      onSubmit={(form) => historyApi.purge(form.get("source") as Source, Number(form.get("days")))}
      onDone={(r) => onDone(`Purged ${r.anomalies} anomalies · ${r.sessions} sessions`)}
    >
      <Field label="Source">
        <SourceSelect />
      </Field>
      <Field label="Older than (days)">
        <NumberInput name="days" defaultValue={14} min={0} step={1} />
      </Field>
    </DialogForm>
  );
}

export function ScenarioDialog({ onDone, onCancel }: DialogProps) {
  const [bundled, setBundled] = useState<{ file: string; yaml: string }[]>([]);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    historyApi
      .scenarios()
      .then((list) => {
        setBundled(list);
        setText((current) => current || list[0]?.yaml || "");
      })
      .catch(() => setBundled([]));
  }, []);

  return (
    <DialogForm
      title="Load scenario"
      text="Scripted history on the current map, one session per day. Coordinates are map-frame meters."
      confirmLabel="Load"
      wide
      onCancel={onCancel}
      onSubmit={() => historyApi.loadScenario(text)}
      onDone={(r) => onDone(`${r.name}: ${r.sessions} sessions · ${r.anomalies} anomalies`)}
    >
      <div className={`${styles.wide} ${styles.toolbar}`}>
        {bundled.length > 0 ? (
          <select className={styles.select} onChange={(e) => setText(bundled.find((b) => b.file === e.target.value)?.yaml ?? "")}>
            {bundled.map((b) => (
              <option key={b.file} value={b.file}>
                {b.file}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.small}>No scenarios in storage/scenarios</span>
        )}
        <Button onClick={() => fileRef.current?.click()}>Open file…</Button>
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(setText);
          }}
        />
      </div>
      <textarea
        className={`${styles.code} ${styles.wide}`}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Scenario YAML"
      />
    </DialogForm>
  );
}
