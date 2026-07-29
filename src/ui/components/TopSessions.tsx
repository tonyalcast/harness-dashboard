import { Copy } from "lucide-react";
import type { Source } from "../../adapters/types";
import { formatTokens, formatUsd } from "../format";

type Row = {
  sessionId: string;
  source: Source;
  project: string | null;
  model: string;
  tokens: { total: number };
  costApi: number;
  start: number;
  end: number;
};

export function TopSessions({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted py-4">No sessions in this range.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {rows.slice(0, 10).map((r) => (
        <li key={`${r.source}-${r.sessionId}`} className="py-2.5 flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex justify-between gap-2 text-sm">
              <span className="truncate font-medium">{r.model}</span>
              <span className="tabular shrink-0 text-calm">{formatUsd(r.costApi)}</span>
            </div>
            <div className="text-xs text-muted truncate mt-0.5" title={r.project ?? undefined}>
              {r.source} · {formatTokens(r.tokens.total)} · {r.project ?? r.sessionId}
            </div>
          </div>
          {r.project && (
            <button
              className="focus-ring p-1.5 rounded text-muted hover:text-text transition-colors duration-150"
              title="Copy project path"
              onClick={() => void navigator.clipboard.writeText(r.project!)}
            >
              <Copy size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
