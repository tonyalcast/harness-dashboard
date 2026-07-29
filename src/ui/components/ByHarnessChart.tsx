import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Source } from "../../adapters/types";
import { formatUsd } from "../format";

type Row = {
  source: Source;
  costApi: number;
  sessions: number;
  tokens: { total: number };
};

const LABELS: Record<Source, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  cursor: "Cursor",
};

export function ByHarnessChart({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => ({
    name: LABELS[r.source],
    cost: r.costApi,
    sessions: r.sessions,
  }));

  if (data.every((d) => d.cost === 0)) {
    return <p className="text-sm text-muted py-8 text-center">No harness cost in this range.</p>;
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" stroke="var(--color-muted)" fontSize={11} />
          <YAxis
            tickFormatter={(v) => formatUsd(v)}
            stroke="var(--color-muted)"
            fontSize={10}
            width={56}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(v) => [formatUsd(Number(v)), "API-equiv"]}
          />
          <Bar dataKey="cost" fill="var(--color-calm)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
