import type { Source } from "../../adapters/types";
import { formatTokens, formatUsd } from "../format";
import { HARNESS_COLOR_CSS } from "../harness-colors";
import { InfoTip } from "./InfoTip";

type Row = {
  source: Source;
  tokens: { total: number };
  costApi: number;
  costReported: number | null;
  sessions: number;
};

const LABELS: Record<Source, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const ORDER: Source[] = ["claude-code", "opencode", "cursor"];

const INFO: Record<Source, string> = {
  "claude-code":
    "Usage read from Claude Code's local session logs in ~/.claude. Exact, per-message counts.",
  opencode:
    "Usage read from OpenCode's local storage. When it records a cost of 0 on real tokens we treat it as missing, not free.",
  cursor:
    "Optional. Pulled from Cursor's account API with your session cookie, and only as coarse monthly totals — not per-message.",
};

export function HarnessCards({ rows }: { rows: Row[] }) {
  const bySource = new Map(rows.map((r) => [r.source, r]));
  const grandTotal = rows.reduce((a, r) => a + r.tokens.total, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {ORDER.map((s) => {
        const r = bySource.get(s);
        const tokens = r?.tokens.total ?? 0;
        const share = grandTotal > 0 ? tokens / grandTotal : 0;
        const idle = tokens === 0;
        return (
          <div key={s} className={`card p-4 ${idle ? "opacity-55" : ""}`}>
            <div className="flex items-baseline justify-between mb-2">
              <div className="metric-label flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: HARNESS_COLOR_CSS[s] }}
                />
                <span style={{ color: HARNESS_COLOR_CSS[s] }}>{LABELS[s]}</span>
                <InfoTip text={INFO[s]} align="left" />
              </div>
              <div className="tabular text-xs text-muted">
                {idle ? "idle" : `${Math.round(share * 100)}%`}
              </div>
            </div>
            <div className="metric-value">{formatTokens(tokens)}</div>
            <div
              className="mt-3 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--color-border)" }}
              role="img"
              aria-label={`${LABELS[s]} share ${Math.round(share * 100)}%`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${share * 100}%`,
                  background: HARNESS_COLOR_CSS[s],
                }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
              <span>
                <span className="tabular text-text">{formatUsd(r?.costApi ?? 0)}</span>{" "}
                api-equiv
              </span>
              <span>
                <span className="tabular text-text">
                  {r?.costReported == null ? "—" : formatUsd(r.costReported)}
                </span>{" "}
                reported
              </span>
              <span>
                <span className="tabular text-text">{r?.sessions ?? 0}</span>{" "}
                {r?.sessions === 1 ? "session" : "sessions"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
