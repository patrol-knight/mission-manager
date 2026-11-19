import type * as maplibregl from "maplibre-gl";

const HEADER = 36;
const LINE = 18;
const GAP = 12;
const PAD = 16;

/** The map's canvas as drawn in its next frame; read inside the render
 * event, before the WebGL buffer is cleared. */
function snapshot(map: maplibregl.Map): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    map.once("render", () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = map.getCanvas().toDataURL("image/png");
    });
    map.triggerRepaint();
  });
}

/** Both maps side by side under their titles, with notes below, as a PNG
 * download. */
export async function saveComparison(
  panes: { map: maplibregl.Map; title: string }[],
  notes: string[],
  filename: string,
): Promise<void> {
  const images = await Promise.all(panes.map((p) => snapshot(p.map)));
  const width = images.reduce((sum, img) => sum + img.width, 0) + GAP * (images.length - 1) + PAD * 2;
  const height = Math.max(...images.map((img) => img.height)) + HEADER + PAD * 2 + notes.length * LINE + GAP;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";

  let x = PAD;
  images.forEach((img, i) => {
    ctx.font = "600 16px system-ui, sans-serif";
    ctx.fillText(panes[i].title, x, PAD + HEADER / 2);
    ctx.drawImage(img, x, PAD + HEADER);
    x += img.width + GAP;
  });

  ctx.font = "13px ui-monospace, monospace";
  ctx.fillStyle = "#4b5563";
  const top = PAD + HEADER + Math.max(...images.map((img) => img.height)) + GAP;
  notes.forEach((note, i) => ctx.fillText(note, PAD, top + LINE * i + LINE / 2));

  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.click();
}
