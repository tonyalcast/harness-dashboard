type Props = {
  start: number | null;
  end: number | null;
  now: number;
  tokens: number;
  burnPerMin: number;
  projectedDepletion: number | null;
};

const WINDOW_MS = 5 * 60 * 60 * 1000;

export function BurnGauge({ start, end, now, tokens, burnPerMin, projectedDepletion }: Props) {
  const has = start != null && end != null;
  const elapsed = has ? Math.min(1, Math.max(0, (now - start!) / (end! - start!))) : 0;
  // Fill represents token burn intensity relative to elapsed time (pace)
  const pace =
    has && elapsed > 0 && burnPerMin > 0
      ? Math.min(1.2, tokens / Math.max(1, burnPerMin * ((now - start!) / 60_000)))
      : elapsed;
  const fill = has ? Math.min(1, elapsed * Math.max(0.15, Math.min(1, pace))) : 0;

  const projFrac =
    has && projectedDepletion
      ? Math.min(1, Math.max(0, (projectedDepletion - start!) / WINDOW_MS))
      : null;

  const tone = fill >= 0.9 ? "var(--color-crit)" : fill >= 0.7 ? "var(--color-warn)" : "var(--color-calm)";

  return (
    <svg viewBox="0 0 1000 56" className="w-full h-14" role="img" aria-label="5-hour burn gauge">
      <rect x="0" y="18" width="1000" height="20" rx="4" fill="#0B0F14" stroke="var(--color-border)" />
      {/* consumption fill */}
      <rect x="0" y="18" width={fill * 1000} height="20" rx="4" fill={tone} opacity="0.85" />
      {/* projected depletion segment */}
      {projFrac != null && projFrac > elapsed && (
        <rect
          x={elapsed * 1000}
          y="18"
          width={(projFrac - elapsed) * 1000}
          height="20"
          fill={tone}
          opacity="0.25"
        />
      )}
      {/* now marker */}
      {has && (
        <g>
          <line
            x1={elapsed * 1000}
            x2={elapsed * 1000}
            y1="10"
            y2="46"
            stroke="var(--color-text)"
            strokeWidth="2"
          />
          <text
            x={Math.min(960, Math.max(20, elapsed * 1000))}
            y="10"
            fill="var(--color-muted)"
            fontSize="11"
            fontFamily="Geist Mono, monospace"
            textAnchor="middle"
          >
            now
          </text>
        </g>
      )}
      {!has && (
        <text
          x="500"
          y="32"
          fill="var(--color-muted)"
          fontSize="12"
          fontFamily="Geist, sans-serif"
          textAnchor="middle"
        >
          No active window
        </text>
      )}
    </svg>
  );
}
