import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./HintLayer.module.css";

/** Show after the cursor rests this long, so sweeping across doesn't flash. */
const DELAY_MS = 150;
/** Flip below the element when there's less room than this above it. */
const MIN_ROOM_ABOVE = 40;
/** Keep the hint's centre this far from the window's sides. */
const EDGE_MARGIN = 90;

interface Hint {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

/**
 * The app's one hover hint, in place of the browser's `title` tooltip: any
 * element with a `data-hint` attribute -- map markers built outside React
 * included -- gets the same small dark label above it. One document
 * listener and one element for the whole app, rendered on <body> so cards
 * with `overflow: hidden` can't clip it.
 */
export function HintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      clearTimeout(timer);
      current = null;
      setHint(null);
    };

    const onOver = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-hint]") : null;
      if (el === current) return;
      hide();
      current = el;
      if (!el) return;
      timer = setTimeout(() => {
        const text = el.dataset.hint;
        if (!text || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < MIN_ROOM_ABOVE;
        const x = Math.min(Math.max(r.left + r.width / 2, EDGE_MARGIN), window.innerWidth - EDGE_MARGIN);
        setHint({ text, x, y: below ? r.bottom + 8 : r.top - 8, below });
      }, DELAY_MS);
    };

    const onOut = (e: MouseEvent) => {
      if (e.relatedTarget === null) hide();
    };

    document.addEventListener("mouseover", onOver);
    document.addEventListener("mouseout", onOut);
    // Whatever was hovered may move or vanish on a click, scroll or zoom.
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("wheel", hide, { passive: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mouseout", onOut);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("wheel", hide);
    };
  }, []);

  if (!hint) return null;
  return createPortal(
    <div
      role="tooltip"
      className={styles.hint}
      style={{ left: hint.x, top: hint.y, transform: hint.below ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}
    >
      {hint.text}
    </div>,
    document.body,
  );
}
