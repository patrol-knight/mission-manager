import { formatSpeed } from "./formatSpeed";

/** Signed speed in m/s. The minus sign has a slot of its own, so the digits
 * don't shift when the robot starts backing up. */
export function Speed({ value, digits }: { value: number | null; digits: number }) {
  if (value === null) return <>—</>;
  const { negative, text } = formatSpeed(value, digits);
  return (
    <span aria-label={`${negative ? "-" : ""}${text} m/s`} style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ display: "inline-block", width: "0.6em", textAlign: "right" }}>
        {negative ? "−" : ""}
      </span>
      {text} m/s
    </span>
  );
}
