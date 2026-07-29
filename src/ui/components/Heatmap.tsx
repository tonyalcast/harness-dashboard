type Day = { day: string; tokens: number };

export function Heatmap({ days }: { days: Day[] }) {
  const map = new Map(days.map((d) => [d.day, d.tokens]));
  const today = new Date();
  const cells: Array<{ day: string; tokens: number; week: number; dow: number }> = [];

  // Build last 53 weeks ending this week
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 52 * 7 - end.getDay());

  for (let d = new Date(start), i = 0; d <= end; d.setDate(d.getDate() + 1), i++) {
    const key = d.toISOString().slice(0, 10);
    cells.push({
      day: key,
      tokens: map.get(key) ?? 0,
      week: Math.floor(i / 7),
      dow: d.getDay(),
    });
  }

  const max = Math.max(...cells.map((c) => c.tokens), 1);
  const weeks = Math.max(...cells.map((c) => c.week)) + 1;

  return (
    <div className="overflow-x-auto">
      <svg width={weeks * 12 + 20} height={7 * 12 + 8} role="img" aria-label="Year activity heatmap">
        {cells.map((c) => {
          const intensity = c.tokens === 0 ? 0 : 0.15 + 0.85 * (c.tokens / max);
          return (
            <rect
              key={c.day}
              x={c.week * 12 + 1}
              y={c.dow * 12 + 1}
              width="10"
              height="10"
              rx="2"
              fill={c.tokens === 0 ? "var(--color-border)" : "var(--color-calm)"}
              opacity={c.tokens === 0 ? 0.35 : intensity}
            >
              <title>
                {c.day}: {c.tokens.toLocaleString()} tokens
              </title>
            </rect>
          );
        })}
        {/* weekly reset boundary hint every 7 days from an arbitrary Monday-aligned mark */}
        {Array.from({ length: Math.floor(weeks / 7) }, (_, i) => (
          <line
            key={i}
            x1={(i + 1) * 7 * 12}
            x2={(i + 1) * 7 * 12}
            y1="0"
            y2={7 * 12}
            stroke="var(--color-muted)"
            strokeOpacity="0.25"
            strokeDasharray="2 2"
          />
        ))}
      </svg>
      <p className="text-[10px] text-muted mt-1">
        Dashed lines mark approximate weekly boundaries. Intensity = tokens/day.
      </p>
    </div>
  );
}
