import { Children, Fragment, isValidElement, type ReactNode } from "react";

/** The buttons in `children`, looking through fragments: a conditional
 * `<>A B</>` is two buttons, not one. */
function countItems(children: ReactNode): number {
  return Children.toArray(children).reduce<number>(
    (n, child) =>
      n +
      (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
        ? countItems(child.props.children)
        : 1),
    0,
  );
}

/** Buttons side by side in equal-width columns -- a grid, so a button
 * wrapped in a tooltip span is exactly as wide as a bare one. Give each
 * button `block` so it fills its column. */
export function ButtonRow({ children, marginTop = 14 }: { children: ReactNode; marginTop?: number }) {
  const columns = countItems(children);
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 8, marginTop }}>
      {children}
    </div>
  );
}
