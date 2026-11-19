import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as maplibregl from "maplibre-gl";
import { lngLatToXy } from "../../../api/mapApi";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { useToast } from "../../../components/useToast";
import { HEATMAP_RAMP_CSS } from "../../map/heatmapColormap";
import devStyles from "../DevPage.module.css";
import { BaselinePanel } from "./BaselinePanel";
import { ConfigPanel } from "./ConfigPanel";
import { Segmented, Slider, ToggleRow } from "../controls";
import { saveComparison } from "./exportImage";
import {
  errorText,
  heatmapApi,
  VERDICTS,
  type BaselineSpec,
  type DemoEvent,
  type HeatmapConfig,
  type HeatmapPreview,
  type HeatmapState,
  type Hotspot,
  type View,
} from "./heatmapApi";
import { HeatmapPane, type ClickMode } from "./HeatmapPane";
import styles from "./Heatmap.module.css";

type Tab = "weights" | "baseline" | "real";
type Confirm = "clear" | "merge";

const VIEW_LABELS: Record<View, string> = { baseline: "Baseline", all: "Baseline + real" };

const NEW_HOTSPOT: Omit<Hotspot, "name" | "x" | "y"> = {
  radius_m: 3,
  per_day: 1,
  verdicts: { true_positive: 0.2, unclear: 0.1, false_positive: 0.2, expired: 0.5 },
  types: ["trespassing", "loitering", "lying_down"],
  confidence: { low: 0.5, high: 0.95 },
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function configNotes(config: HeatmapConfig): string[] {
  const w = config.verdict_weights;
  const t = config.type_weights;
  return [
    `verdict  true ${w.true_positive}  unclear ${w.unclear}  false ${w.false_positive}  expired ${w.expired}` +
      `   × confidence for ${config.confidence_for.join(", ") || "none"}`,
    `type  trespassing ${t.trespassing}  loitering ${t.loitering}  lying down ${t.lying_down}`,
    `half-life ${config.half_life_days ? `${config.half_life_days} d` : "off"}   σ ${config.bandwidth_m} m   full color at ${config.full_at}`,
  ];
}

function PaneHeader({ view, preview, onView }: { view: View; preview: HeatmapPreview | null; onView: (v: View) => void }) {
  const total = preview ? Object.values(preview.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <Segmented<View> options={[["baseline", "Baseline"], ["all", "Baseline + real"]]} value={view} onChange={onView} />
      {preview && (
        <span className={devStyles.muted}>
          {total} events · peak {Math.round(preview.peak_level * 100)}%
        </span>
      )}
    </>
  );
}

function ConfirmDialog({ kind, realEvents, onConfirm, onCancel }: {
  kind: Confirm;
  realEvents: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const clear = kind === "clear";
  return (
    <Modal label={clear ? "Clear real events" : "Merge into baseline"} onClose={onCancel}>
      <div className={styles.dialog}>
        <div className={styles.dialogTitle}>{clear ? "Clear real events?" : "Merge real events into the baseline?"}</div>
        <div className={styles.dialogText}>
          {clear
            ? `Deletes the ${realEvents} real events recorded on this machine (real.jsonl). The baseline stays.`
            : `Moves the ${realEvents} real events into baseline.jsonl, which is tracked in git. Generating the baseline again drops them.`}
        </div>
        <div className={styles.dialogActions}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={clear ? "dangerSolid" : "primary"} onClick={onConfirm}>
            {clear ? "Clear" : "Merge"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function HeatmapView() {
  const { show } = useToast();
  const [saved, setSaved] = useState<HeatmapState | null>(null);
  const [config, setConfig] = useState<HeatmapConfig | null>(null);
  const [spec, setSpec] = useState<BaselineSpec | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("weights");
  const [views, setViews] = useState<[View, View]>(["baseline", "all"]);
  const [previews, setPreviews] = useState<[HeatmapPreview | null, HeatmapPreview | null]>([null, null]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoEvent[]>([]);
  const [mode, setMode] = useState<ClickMode>("select");
  const [selected, setSelected] = useState<number | null>(null);
  const [moved, setMoved] = useState<{ index: number; lngLat: [number, number] } | null>(null);
  const [opacity, setOpacity] = useState(0.7);
  const [showPoints, setShowPoints] = useState(true);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const maps = useRef<[maplibregl.Map | null, maplibregl.Map | null]>([null, null]);
  const [mapsReady, setMapsReady] = useState(0);

  const adopt = (state: HeatmapState) => {
    setSaved(state);
    setSpec(state.spec);
  };

  const load = useCallback(
    () =>
      heatmapApi
        .state()
        .then((s) => {
          setSaved(s);
          setSpec(s.spec);
          setConfig(s.config);
          setLoadError(null);
        })
        .catch((err: unknown) => setLoadError(errorText(err))),
    [],
  );
  useEffect(() => void load(), [load]);

  const specDirty = !!saved && !!spec && !same(spec, saved.spec);
  const configDirty = !!saved && !!config && !same(config, saved.config);
  const bodies = useMemo(
    () =>
      config && spec
        ? views.map((view) => ({ config, view, spec: specDirty ? spec : null, demo: view === "all" ? demo : [] }))
        : null,
    [config, spec, specDirty, views, demo],
  );
  const bodiesKey = JSON.stringify(bodies);

  useEffect(() => {
    if (!bodies) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all(bodies.map((body) => heatmapApi.preview(body)))
        .then(([left, right]) => {
          if (cancelled) return;
          setPreviews([left, right]);
          setMoved(null);
          setPreviewError(null);
        })
        .catch((err: unknown) => !cancelled && setPreviewError(errorText(err)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // bodiesKey stands for bodies; a saved state refetches too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodiesKey, saved]);

  useEffect(() => {
    const [a, b] = maps.current;
    if (!a || !b) return;
    let syncing = false;
    const follow = (from: maplibregl.Map, to: maplibregl.Map) => () => {
      if (syncing) return;
      syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing() });
      syncing = false;
    };
    const ab = follow(a, b);
    const ba = follow(b, a);
    a.on("move", ab);
    b.on("move", ba);
    return () => {
      a.off("move", ab);
      b.off("move", ba);
    };
  }, [mapsReady]);

  const run = (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    action()
      .then(() => done && show("success", done))
      .catch((err: unknown) => show("error", errorText(err)))
      .finally(() => setBusy(false));
  };

  const setHotspotXy = async (index: number | null, lngLat: maplibregl.LngLat) => {
    if (!spec) return;
    const { x, y } = await lngLatToXy(lngLat.lat, lngLat.lng);
    const at = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    setSpec((s) => {
      if (!s) return s;
      if (index !== null) return { ...s, hotspots: s.hotspots.map((h, i) => (i === index ? { ...h, ...at } : h)) };
      return { ...s, hotspots: [...s.hotspots, { ...NEW_HOTSPOT, name: `Hotspot ${s.hotspots.length + 1}`, ...at }] };
    });
    if (index === null) setSelected(spec.hotspots.length);
  };

  const onMapClick = (lngLat: maplibregl.LngLat) => {
    if (mode === "demo") {
      setDemo((d) => [...d, { lon: lngLat.lng, lat: lngLat.lat }]);
    } else if (mode === "hotspot") {
      setMode("select");
      setHotspotXy(null, lngLat).catch((err: unknown) => show("error", errorText(err)));
    }
  };

  const onMove = (index: number, lngLat: maplibregl.LngLat) => {
    setMoved({ index, lngLat: [lngLat.lng, lngLat.lat] });
    setHotspotXy(index, lngLat).catch((err: unknown) => show("error", errorText(err)));
  };

  const saveImage = () => {
    const [left, right] = maps.current;
    if (!left || !right || !config || !saved) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    run(() =>
      saveComparison(
        [
          { map: left, title: VIEW_LABELS[views[0]] },
          { map: right, title: VIEW_LABELS[views[1]] },
        ],
        [`${saved.map_name} · ${new Date().toLocaleString()}`, ...configNotes(config)],
        `heatmap-${saved.map_name}-${stamp}.png`,
      ),
    );
  };

  if (loadError) {
    return (
      <section className={`${devStyles.card} ${devStyles.empty}`}>
        <span className={devStyles.bad}>{loadError}</span>
        <div>
          <Button onClick={load}>Try again</Button>
        </div>
      </section>
    );
  }
  if (!saved || !config || !spec) return <span className={devStyles.muted}>Loading…</span>;

  const radii = spec.hotspots.map((h) => h.radius_m);
  const counts = previews[1]?.counts;

  return (
    <div className={styles.layout}>
      {[0, 1].map((i) => (
        <HeatmapPane
          key={i}
          header={
            <PaneHeader
              view={views[i]}
              preview={previews[i]}
              onView={(v) => setViews((vs) => (i === 0 ? [v, vs[1]] : [vs[0], v]))}
            />
          }
          preview={previews[i]}
          radii={radii}
          selected={selected}
          moved={moved}
          opacity={opacity}
          showPoints={showPoints}
          mode={mode}
          onMap={(map) => {
            maps.current[i] = map;
            setMapsReady((n) => n + 1);
          }}
          onClick={onMapClick}
          onSelect={(index) => {
            setSelected(index);
            setTab("baseline");
          }}
          onMove={onMove}
        />
      ))}

      <aside className={styles.panel}>
        <Segmented<Tab>
          full
          options={[["weights", "Weights"], ["baseline", "Baseline"], ["real", "Real"]]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setMode("select");
          }}
        />

        {tab === "weights" && (
          <>
            <ConfigPanel config={config} onChange={setConfig} />
            <div className={styles.actions}>
              <Button size="sm" variant="ghost" onClick={() => setConfig(saved.defaults)}>
                Defaults
              </Button>
              <Button size="sm" disabled={!configDirty} onClick={() => setConfig(saved.config)}>
                Revert
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!configDirty || busy}
                onClick={() =>
                  run(async () => {
                    await heatmapApi.saveConfig(config);
                    setSaved({ ...saved, config });
                  }, "Saved config.yaml")
                }
              >
                Save
              </Button>
            </div>
          </>
        )}

        {tab === "baseline" && (
          <>
            {saved.baseline.stale && (
              <span className={devStyles.bad}>baseline.yaml changed since baseline.jsonl was generated. Save to regenerate.</span>
            )}
            {saved.baseline.merged_real > 0 && (
              <span className={styles.hint}>
                Includes {saved.baseline.merged_real} merged real events; saving a new baseline drops them.
              </span>
            )}
            <BaselinePanel
              spec={spec}
              preview={previews[0]}
              selected={selected}
              adding={mode === "hotspot"}
              onSelect={setSelected}
              onChange={setSpec}
              onAdd={() => setMode(mode === "hotspot" ? "select" : "hotspot")}
            />
            <div className={styles.actions}>
              <Button size="sm" disabled={!specDirty} onClick={() => setSpec(saved.spec)}>
                Revert
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={(!specDirty && !saved.baseline.stale) || busy}
                onClick={() => run(async () => adopt(await heatmapApi.saveBaseline(spec)), "Generated baseline")}
              >
                Save & generate
              </Button>
            </div>
          </>
        )}

        {tab === "real" && (
          <>
            <section className={styles.section}>
              <h4 className={devStyles.sectionTitle}>Recorded</h4>
              <span>
                {saved.real_events} real events in <span className={devStyles.mono}>real.jsonl</span>
              </span>
              <div className={styles.actions}>
                <Button size="sm" disabled={!saved.real_events || busy} onClick={() => setConfirm("merge")}>
                  Merge into baseline
                </Button>
                <Button size="sm" variant="danger" disabled={!saved.real_events || busy} onClick={() => setConfirm("clear")}>
                  Clear
                </Button>
              </div>
            </section>
            <section className={styles.section}>
              <h4 className={devStyles.sectionTitle}>Demo rehearsal</h4>
              <span className={styles.hint}>
                Click the map to add what-if true positives to the “Baseline + real” view. They are never saved.
              </span>
              <div className={styles.actions}>
                <Button size="sm" variant={mode === "demo" ? "primary" : "secondary"} onClick={() => setMode(mode === "demo" ? "select" : "demo")}>
                  {mode === "demo" ? "Done placing" : "Place trues"}
                </Button>
                <Button size="sm" disabled={!demo.length} onClick={() => setDemo([])}>
                  Clear {demo.length || ""}
                </Button>
              </div>
            </section>
          </>
        )}

        <div className={styles.panelFoot}>
          <Slider
            label="Opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={setOpacity}
          />
          <div className={styles.ramp} style={{ background: HEATMAP_RAMP_CSS }} />
          <div className={styles.rampLabels}>
            <span>0</span>
            <span>{config.full_at} weighted events</span>
          </div>
          <ToggleRow label="Show events" on={showPoints} onChange={setShowPoints} />
          {counts && (
            <div className={styles.counts}>
              {VERDICTS.map(([key, label, color]) => (
                <span key={key}>
                  <b>{counts[key] ?? 0}</b>
                  <span className={styles.swatch} style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          )}
          {previewError ? (
            <span className={devStyles.bad}>{previewError}</span>
          ) : (
            previews[1] && <span>{saved.map_name} · {previews[1].elapsed_ms} ms</span>
          )}
          <Button size="sm" disabled={busy} onClick={saveImage}>
            Save image
          </Button>
        </div>
      </aside>

      {confirm && (
        <ConfirmDialog
          kind={confirm}
          realEvents={saved.real_events}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            run(
              async () => adopt(await (confirm === "clear" ? heatmapApi.clearReal() : heatmapApi.mergeReal())),
              confirm === "clear" ? "Cleared real events" : "Merged into baseline",
            );
          }}
        />
      )}
    </div>
  );
}
