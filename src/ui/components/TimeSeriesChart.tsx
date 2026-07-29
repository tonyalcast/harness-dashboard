import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Source } from "../../adapters/types";
import { formatTokens } from "../format";

type Point = { t: number; tokens: number; costApi: number; source: Source };

export function TimeSeriesChart({ series }: { series: Point[] }) {
  // Merge sources into total per bucket for a clean single series
  const map = new Map<number, number>();
  for (const p of series) map.set(p.t, (map.get(p.t) ?? 0) + p.tokens);
  const data = [...map.entries()]
    .map(([t, tokens]) => ({ t, tokens }))
    .sort((a, b) => a.t - b.t);

  if (data.length === 0) {
    return <p className="text-sm text-muted py-8 text-center">No points in this range.</p>;
  }

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            tickFormatter={(t) =>
              new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" })
            }
            stroke="var(--color-muted)"
            fontSize={10}
          />
          <YAxis
            tickFormatter={(v) => formatTokens(v)}
            stroke="var(--color-muted)"
            fontSize={10}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 12,
            }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString()}
            formatter={(v) => [formatTokens(Number(v)), "tokens"]}
          />
          <Area
            type="monotone"
            dataKey="tokens"
            stroke="var(--color-accent)"
            fill="var(--color-accent)"
            fillOpacity={0.15}
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
