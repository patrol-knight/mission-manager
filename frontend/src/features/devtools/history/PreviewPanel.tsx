import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { Button } from "../../../components/ui/Button";
import { useToast } from "../../../components/useToast";
import { copyText } from "../../../utils/copyText";
import { colorizeHeatmap, HEATMAP_RAMP_CSS } from "../../map/heatmapColormap";
import { LaneletLayer } from "../../map/LaneletLayer";
import { MapContext } from "../../map/MapContext";
import { MapWorkspace } from "../../map/MapWorkspace";
import { useMapInstance } from "../../map/useMapInstance";
import devStyles from "../DevPage.module.css";
import { Segmented, Slider, ToggleRow } from "./controls";
import { errorText, VERDICTS } from "./historyFormat";
import { historyApi, type HeatmapPreview, type HistoryStatus, type SourceFilter } from "./historyApi";
import { defaultState, envLines, formatRate, heatmapQuery, type Model, type PreviewState } from "./previewConfig";
import styles from "./History.module.css";

const STORAGE_KEY = "mm.dev.history.preview.v1";
const HEAT_ID = "history-heat";
const POINTS_ID = "history-points";
// MapLibre paints can't read CSS variables.
const POINT_COLORS = {
  true_positive: "#c51e3a",
  unclear: "#6b7280",
  expired: "#b8bcc4",
  false_positive: "#16a34a",
};

function loadState(fallback: PreviewState): PreviewState {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return fallback;
  }
}

function saveState(state: PreviewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private window or blocked storage
  }
}

function toDataUrl(width: number, height: number, data: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(colorizeHeatmap(data), width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function heatOpacity(opacity: number): maplibregl.ExpressionSpecification {
  return ["interpolate", ["linear"], ["zoom"], 18, opacity, 21, opacity * 0.6];
}

function PreviewLayers({
  map,
  ready,
  data,
  opacity,
  showPoints,
}: {
  map: maplibregl.Map | null;
  ready: boolean;
  data: HeatmapPreview | null;
  opacity: number;
  showPoints: boolean;
}) {
  useEffect(() => {
    if (!map || !ready) return;
    map.addSource(POINTS_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: POINTS_ID,
      type: "circle",
      source: POINTS_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 0, 2.5, 1, 6],
        "circle-color": [
          "match",
          ["get", "verdict"],
          "true_positive",
          POINT_COLORS.true_positive,
          "unclear",
          POINT_COLORS.unclear,
          "expired",
          POINT_COLORS.expired,
          "false_positive",
          POINT_COLORS.false_positive,
          "#999",
        ],
        "circle-stroke-color": "#fff",
        "circle-stroke-width": 1,
        "circle-opacity": 0.9,
      },
    });
    return () => {
      for (const id of [POINTS_ID, HEAT_ID]) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
  }, [map, ready]);

  useEffect(() => {
    if (!map || !ready || !data || !map.getSource(POINTS_ID)) return;
    const grid = data.grid;
    if (grid) {
      const image = {
        url: toDataUrl(grid.width, grid.height, grid.data),
        coordinates: grid.corners as [[number, number], [number, number], [number, number], [number, number]],
      };
      const source = map.getSource(HEAT_ID) as maplibregl.ImageSource | undefined;
      if (source) {
        source.updateImage(image);
        map.setLayoutProperty(HEAT_ID, "visibility", "visible");
      } else {
        map.addSource(HEAT_ID, { type: "image", ...image });
        map.addLayer(
          {
            id: HEAT_ID,
            type: "raster",
            source: HEAT_ID,
            paint: { "raster-resampling": "linear", "raster-fade-duration": 0 },
          },
          map.getLayer("ll-left") ? "ll-left" : POINTS_ID,
        );
      }
    } else if (map.getLayer(HEAT_ID)) {
      map.setLayoutProperty(HEAT_ID, "visibility", "none");
    }
    (map.getSource(POINTS_ID) as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: data.points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
        properties: { verdict: p.verdict, weight: p.weight },
      })),
    });
  }, [map, ready, data]);

  useEffect(() => {
    if (!map || !ready) return;
    if (map.getLayer(HEAT_ID)) map.setPaintProperty(HEAT_ID, "raster-opacity", heatOpacity(opacity));
    if (map.getLayer(POINTS_ID)) map.setLayoutProperty(POINTS_ID, "visibility", showPoints ? "visible" : "none");
  }, [map, ready, data, opacity, showPoints]);

  return null;
}

export function PreviewPanel({ status }: { status: HistoryStatus }) {
  const { show } = useToast();
  const defaults = defaultState(status.heatmap);
  const [state, setState] = useState<PreviewState>(() => loadState(defaults));
  const [data, setData] = useState<HeatmapPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, ready } = useMapInstance(containerRef);
  const queryKey = JSON.stringify(heatmapQuery(state));

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      historyApi
        .heatmap(JSON.parse(queryKey))
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
        })
        .catch((err: unknown) => !cancelled && setError(errorText(err)));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryKey]);

  const set = <K extends keyof PreviewState>(key: K, value: PreviewState[K]) =>
    setState((s) => {
      const next = { ...s, [key]: value };
      saveState(next);
      return next;
    });

  const reset = () => {
    saveState(defaults);
    setState(defaults);
  };

  const copy = () =>
    void copyText(envLines(state)).then((ok) =>
      ok ? show("success", "Copied .env lines", "Paste into the root .env and restart the backend") : show("error", "Clipboard unavailable"),
    );

  const demand = state.model === "demand";
  const bandwidthKey = demand ? "demand_bandwidth_m" : "density_bandwidth_m";
  const logSlider = (label: string, key: "floor_per_hour" | "ceiling_per_hour", min: number, max: number) => (
    <Slider
      label={label}
      min={Math.log10(min)}
      max={Math.log10(max)}
      step={0.05}
      value={Math.log10(state[key])}
      format={(v) => `${formatRate(10 ** v)}/h`}
      onChange={(v) => set(key, Number((10 ** v).toPrecision(3)))}
    />
  );
  const sourceLabel = { sim: "sim", real: "real", all: "sim + real" }[state.source];
  const stats = data?.stats;

  return (
    <div className={styles.preview}>
      <div className={styles.mapBox}>
        <MapContext.Provider value={{ map, ready }}>
          <MapWorkspace containerRef={containerRef} map={map} ready={ready}>
            <LaneletLayer />
            <PreviewLayers map={map} ready={ready} data={data} opacity={state.opacity} showPoints={state.show_points} />
          </MapWorkspace>
        </MapContext.Provider>
        {stats && (
          <div className={styles.badge}>
            {status.map_name} · {stats.records ? `${stats.records.toLocaleString()} ${sourceLabel} anomalies` : `no ${sourceLabel} history`}
          </div>
        )}
      </div>

      <aside className={styles.panel}>
        <section className={styles.section}>
          <h4 className={devStyles.sectionTitle}>Model</h4>
          <Segmented<Model>
            full
            options={[["demand", "v2 Demand"], ["density", "v1 Density"]]}
            value={state.model}
            onChange={(v) => set("model", v)}
          />
        </section>

        <section className={styles.section}>
          <h4 className={devStyles.sectionTitle}>Data</h4>
          <Segmented<SourceFilter>
            full
            options={[["sim", "Sim"], ["real", "Real"], ["all", "Both"]]}
            value={state.source}
            onChange={(v) => set("source", v)}
          />
          <ToggleRow label="Include excluded sessions" on={state.include_excluded} onChange={(v) => set("include_excluded", v)} />
          {stats && (
            <div className={styles.counts}>
              {VERDICTS.map(([key, label, color]) => (
                <span key={key}>
                  <b>{stats.counts[key].toLocaleString()}</b>
                  <span className={styles.swatch} style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h4 className={devStyles.sectionTitle}>Kernel</h4>
          <Slider
            label="Bandwidth"
            min={1}
            max={15}
            step={0.5}
            value={state[bandwidthKey]}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(v) => set(bandwidthKey, v)}
          />
          <Slider
            label="Half-life"
            min={0}
            max={120}
            step={1}
            value={state.half_life_days}
            format={(v) => (v ? `${v} days` : "Off")}
            onChange={(v) => set("half_life_days", v)}
          />
          {demand ? (
            <>
              <Slider
                label="Prior"
                min={0}
                max={24}
                step={0.5}
                value={state.prior_hours}
                format={(v) => `${v} h`}
                onChange={(v) => set("prior_hours", v)}
              />
              <ToggleRow label="Per-device uptime" on={state.per_device} onChange={(v) => set("per_device", v)} />
            </>
          ) : (
            <ToggleRow label="Weight by confidence" on={state.use_confidence} onChange={(v) => set("use_confidence", v)} />
          )}
        </section>

        {demand ? (
          <section className={styles.section}>
            <h4 className={devStyles.sectionTitle}>Scale</h4>
            {logSlider("Transparent below", "floor_per_hour", 0.001, 1)}
            {logSlider("Full color at", "ceiling_per_hour", 0.1, 50)}
          </section>
        ) : (
          <section className={styles.section}>
            <h4 className={devStyles.sectionTitle}>Verdict weights</h4>
            {VERDICTS.map(([key, label, color]) => (
              <Slider
                key={key}
                label={label}
                swatch={color}
                min={0}
                max={1}
                step={0.05}
                value={state[`w_${key}`]}
                format={(v) => v.toFixed(2)}
                onChange={(v) => set(`w_${key}`, v)}
              />
            ))}
          </section>
        )}

        <section className={styles.section}>
          <h4 className={devStyles.sectionTitle}>Display</h4>
          <Slider
            label="Opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={state.opacity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set("opacity", v)}
          />
          <div className={styles.ramp} style={{ background: HEATMAP_RAMP_CSS }} />
          <div className={styles.rampLabels}>
            <span>{demand ? `${formatRate(state.floor_per_hour)}/h` : "Low"}</span>
            <span>{demand ? `${formatRate(state.ceiling_per_hour)}/h` : "High"}</span>
          </div>
          <ToggleRow label="Show anomalies" on={state.show_points} onChange={(v) => set("show_points", v)} />
        </section>

        <div className={styles.panelFoot}>
          {error ? (
            <span className={devStyles.bad}>{error}</span>
          ) : (
            stats && (
              <span>
                {stats.operating_hours !== undefined
                  ? `${stats.operating_hours} h operating · peak ${formatRate(stats.peak_per_hour ?? 0)}/h · ${stats.elapsed_ms} ms`
                  : `${stats.records.toLocaleString()} records · ${stats.elapsed_ms} ms`}
              </span>
            )
          )}
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" onClick={reset}>
              Reset
            </Button>
            <Button
              size="sm"
              disabled={!demand}
              title={demand ? "Root .env lines for the mission editor's heatmap" : "The mission editor uses v2 Demand"}
              onClick={copy}
            >
              Copy config
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
