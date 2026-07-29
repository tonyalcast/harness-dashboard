import { InfoTip } from "./InfoTip";

type Props = {
  label: string;
  value: string;
  hint?: string;
  /** Plain-language explanation, shown via the info icon. */
  info?: string;
  tone?: "default" | "calm" | "warn" | "crit";
};

export function MetricCard({ label, value, hint, info, tone = "default" }: Props) {
  const color =
    tone === "calm"
      ? "text-calm"
      : tone === "warn"
        ? "text-warn"
        : tone === "crit"
          ? "text-crit"
          : "text-text";
  return (
    <div className="card p-4">
      <div className="metric-label mb-2 flex items-center justify-between gap-2">
        <span>{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className={`metric-value ${color}`}>{value}</div>
      {hint && <div className="text-xs text-muted mt-2 leading-relaxed">{hint}</div>}
    </div>
  );
}
