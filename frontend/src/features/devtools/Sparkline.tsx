interface SparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  /** Marks samples where this is true (lost pings) as red ticks. */
  marks?: boolean[];
}

export function Sparkline({ values, width = 160, height = 28, color = "var(--color-primary)", marks }: SparklineProps) {
  const finite = values.filter((v): v is number => v !== null);
  const max = finite.length ? Math.max(...finite) : 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const y = (v: number) => height - 2 - (max > 0 ? (v / max) * (height - 4) : 0);

  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (current.length) segments.push(current.join(" "));

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", maxWidth: width * 2 }}
    >
      {segments.map((points, i) =>
        points.includes(" ") ? (
          <polyline key={i} points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key={i} cx={points.split(",")[0]} cy={points.split(",")[1]} r={1.5} fill={color} />
        ),
      )}
      {marks?.map((mark, i) =>
        mark ? <line key={`m${i}`} x1={i * step} x2={i * step} y1={0} y2={height} stroke="var(--color-danger)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null,
      )}
    </svg>
  );
}
