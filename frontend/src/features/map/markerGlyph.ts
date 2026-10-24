/** Sets the digit or symbol inside a round marker so it sits in the optical
 * centre. A plain text node is centred by its font box, which includes room
 * for descenders, so digits and "!" read slightly low; the .marker-glyph
 * span (index.css) trims that box to the cap height first. */
export function setMarkerGlyph(el: HTMLElement, text: string): void {
  let glyph = el.querySelector<HTMLSpanElement>(":scope > .marker-glyph");
  if (!glyph) {
    el.textContent = "";
    glyph = document.createElement("span");
    glyph.className = "marker-glyph";
    el.appendChild(glyph);
  }
  if (glyph.textContent !== text) glyph.textContent = text;
}
