import { formatTokens } from "../format";
import { SectionLabel } from "./InfoTip";

type Props = {
  pct: number | null;
  calibrated: boolean;
  tokens: number;
  baseline: number;
  onCalibrate: () => void;
};

export function WeeklyRing({ pct, calibrated, tokens, baseline, onCalibrate }: Props) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const shown = pct != null ? Math.min(100, Math.max(0, pct)) : 0;
  const offset = c - (shown / 100) * c;
  const tone =
    shown >= 100 ? "var(--color-crit)" : shown >= 80 ? "var(--color-warn)" : "var(--color-calm)";

  return (
    <div className="flex items-center gap-4">
      <svg width="110" height="110" viewBox="0 0 110 110" aria-label="Weekly usage estimate">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--color-border)" strokeWidth="8" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={calibrated ? tone : "var(--color-muted)"}
          strokeWidth="8"
          strokeDasharray={c}
          strokeDashoffset={calibrated ? offset : c}
          strokeLinecap="round"
          transform="rotate(-90 55 55)"
        />
        <text
          x="55"
          y="52"
          textAnchor="middle"
          fill="var(--color-text)"
          fontSize="18"
          fontFamily="Geist Mono, monospace"
        >
          {calibrated && pct != null ? `${Math.round(pct)}%` : "—"}
        </text>
        <text
          x="55"
          y="68"
          textAnchor="middle"
          fill="var(--color-muted)"
          fontSize="10"
          fontFamily="Geist, sans-serif"
        >
          est.
        </text>
      </svg>
      <div className="flex-1">
        <SectionLabel
          className="mb-1"
          info="Estimated share of your weekly limit used so far. Anthropic does not publish the exact cap, so this is measured against your own baseline — hit Calibrate the next time you actually run out."
        >
          Weekly
        </SectionLabel>
        <p className="text-sm text-muted mb-2" title="Caps aren't published; this is calibrated against your own baseline.">
          {calibrated
            ? `${formatTokens(tokens)} of ~${formatTokens(baseline)} baseline`
            : `${formatTokens(tokens)} this week — calibrate when you hit a limit`}
        </p>
        <button
          className="focus-ring text-xs px-3 py-1.5 rounded border border-border text-accent hover:border-accent/60 transition-colors duration-150"
          onClick={onCalibrate}
          title="Set baseline from the current 7-day token total"
        >
          Calibrate
        </button>
      </div>
    </div>
  );
}
