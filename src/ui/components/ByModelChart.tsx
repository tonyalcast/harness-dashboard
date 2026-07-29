import { formatTokens, formatUsd } from "../format";

type Row = {
  model: string;
  costApi: number;
  share: number;
  tokens: { total: number };
};

export function ByModelChart({ rows }: { rows: Row[] }) {
  const top = rows.slice(0, 8);
  if (top.length === 0) {
    return <p className="text-sm text-muted py-8 text-center">No model data yet.</p>;
  }
  const max = Math.max(...top.map((r) => r.costApi), 0.01);

  return (
    <ul className="space-y-2">
      {top.map((r) => (
        <li key={r.model}>
          <div className="flex justify-between text-xs mb-1">
            <span className="truncate mr-2" title={r.model}>
              {r.model}
            </span>
            <span className="tabular text-muted shrink-0">
              {formatUsd(r.costApi)} · {(r.share * 100).toFixed(0)}% · {formatTokens(r.tokens.total)}
            </span>
          </div>
          <div className="h-1.5 rounded bg-bg overflow-hidden">
            <div
              className="h-full rounded bg-accent/70"
              style={{ width: `${(r.costApi / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
