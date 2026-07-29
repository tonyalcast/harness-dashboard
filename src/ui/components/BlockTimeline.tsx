import { formatTokens } from "../format";

type Block = { start: number; end: number; tokens: number; isCurrent: boolean };

export function BlockTimeline({ blocks }: { blocks: Block[] }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-muted py-4">No blocks inferred for today.</p>;
  }
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const origin = dayStart.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const maxTok = Math.max(...blocks.map((b) => b.tokens), 1);

  return (
    <div className="relative h-16 bg-bg rounded border border-border overflow-hidden">
      {blocks.map((b, i) => {
        const left = Math.max(0, ((b.start - origin) / dayMs) * 100);
        const width = Math.max(0.5, ((b.end - b.start) / dayMs) * 100);
        const intensity = 0.25 + 0.75 * (b.tokens / maxTok);
        return (
          <div
            key={i}
            title={`${new Date(b.start).toLocaleTimeString()}–${new Date(b.end).toLocaleTimeString()} · ${formatTokens(b.tokens)}`}
            className="absolute top-2 bottom-2 rounded-sm"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              background: b.isCurrent ? "var(--color-warn)" : "var(--color-calm)",
              opacity: intensity,
            }}
          />
        );
      })}
      <div className="absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  );
}
