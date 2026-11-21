import { useContext, useEffect, useMemo } from "react";
import { MapContext } from "./MapContext";
import { useMarkerList, type UseMarkerListOptions } from "./mapMarkers";
import { useInvestigationStore } from "../../stores/investigationStore";
import { useMapHighlightStore } from "../../stores/mapHighlightStore";
import { previewExplore } from "../../api/investigationApi";
import { mapPalette } from "./mapPalette";
import { setMarkerGlyph } from "./markerGlyph";

interface ExplorePoint {
  lat: number;
  lon: number;
  /** The robot is sent there (the card is hovered: it grows). */
  sent: boolean;
}

const SIZE = 22;
const SIZE_HOVERED = 28;

/** Just a grey "x" with a white halo, readable on the map without a disc. */
function buildPointElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width:${SIZE}px;height:${SIZE}px;
    display:flex;align-items:center;justify-content:center;
    color:${mapPalette.explorePick};font:800 ${SIZE}px/1 system-ui,sans-serif;
    text-shadow:0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff;
    transition:font-size 150ms ease-out;
    z-index:8;
  `;
  setMarkerGlyph(el, "×");
  return el;
}

/** Explore on the map. While picking, a click picks the point to look at
 * (another click moves it) and asks the backend where the robot would stop;
 * Esc cancels. The point is a grey "x", picked or sent alike; its stop is
 * drawn by InvestigationTargetLayer. */
export function ExploreLayer() {
  const { map } = useContext(MapContext);
  const picking = useInvestigationStore((s) => s.picking);
  const picked = useInvestigationStore((s) => s.picked);
  const exploring = useInvestigationStore((s) => (s.investigation?.kind === "explore" ? s.investigation : null));
  const hovered = useMapHighlightStore((s) => s.hoveredExplore);

  useEffect(() => {
    if (!map || !picking) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    const pick = (e: { lngLat: { lat: number; lng: number } }) => {
      const { lat, lng: lon } = e.lngLat;
      const { setPicked } = useInvestigationStore.getState();
      setPicked({ lat, lon, preview: null, error: null });
      const stillPicked = () => {
        const now = useInvestigationStore.getState().picked;
        return now !== null && now.lat === lat && now.lon === lon;
      };
      previewExplore(lat, lon)
        .then((preview) => stillPicked() && setPicked({ lat, lon, preview, error: null }))
        .catch((err) => stillPicked() && setPicked({ lat, lon, preview: null, error: err instanceof Error ? err.message : "Can't reach" }));
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useInvestigationStore.getState().stopPicking();
    map.on("click", pick);
    window.addEventListener("keydown", onKey);
    return () => {
      canvas.style.cursor = "";
      map.off("click", pick);
      window.removeEventListener("keydown", onKey);
    };
  }, [map, picking]);

  const points = useMemo<ExplorePoint[]>(() => {
    if (picked) return [{ lat: picked.lat, lon: picked.lon, sent: false }];
    const at = exploring?.lookAt;
    return at?.lat != null && at.lon != null ? [{ lat: at.lat, lon: at.lon, sent: true }] : [];
  }, [picked, exploring]);
  const onSite = exploring?.phase === "on_site";

  const options = useMemo<UseMarkerListOptions<ExplorePoint>>(
    () => ({
      keyOf: () => "explore-point",
      dependsOn: (p) => [p.lat, p.lon],
      project: async (p) => ({ lng: p.lon, lat: p.lat }),
      buildElement: buildPointElement,
      updateElement: (el, p) => {
        el.style.fontSize = `${p.sent && hovered ? SIZE_HOVERED : SIZE}px`;
        el.dataset.hint = p.sent ? (onSite ? "Explore · On site" : "Explore · En route") : "Explore here";
      },
    }),
    [hovered, onSite],
  );

  useMarkerList(map, points, options, [hovered, onSite]);
  return null;
}
