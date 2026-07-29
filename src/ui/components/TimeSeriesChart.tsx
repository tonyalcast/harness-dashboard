import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Source } from "../../adapters/types";
import { formatTokens } from "../format";

type Point = {
  t: number;
  tokens: number;
  costApi: number;
  source: Source;
  model: string;
};

type GroupBy = "model" | "harness";

const PALETTE = [
  "#8b9eff",
  "#4fd1c5",
  "#f5a524",
  "#ef5a5a",
  "#c084fc",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#fbbf24",
  "#a3e635",
  "#22d3ee",
  "#e879f9",
];

const HARNESS: Record<Source, string> = {
  "claude-code": "Claude",
  opencode: "OpenCode",
  cursor: "Cursor",
};

const HARNESS_ORDER: Source[] = ["claude-code", "opencode", "cursor"];

const HARNESS_COLOR: Record<Source, string> = {
  "claude-code": "#8b9eff",
  opencode: "#4fd1c5",
  cursor: "#f5a524",
};

function modelKey(p: Pick<Point, "source" | "model">): string {
  return `${p.source}::${p.model}`;
}

function modelLabel(key: string): string {
  const i = key.indexOf("::");
  if (i < 0) return key;
  const source = key.slice(0, i) as Source;
  const model = key.slice(i + 2);
  return `${model} · ${HARNESS[source] ?? source}`;
}

function harnessLabel(key: string): string {
  return HARNESS[key as Source] ?? key;
}

export function TimeSeriesChart({ series }: { series: Point[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>("model");

  const { keys, data, labelOf, colorOf } = useMemo(() => {
    if (groupBy === "harness") {
      const totals = new Map<string, number>();
      for (const p of series) {
        totals.set(p.source, (totals.get(p.source) ?? 0) + p.tokens);
      }
      const keys = HARNESS_ORDER.filter((s) => (totals.get(s) ?? 0) > 0);
      const byTime = new Map<number, Record<string, number | string>>();
      for (const p of series) {
        if ((totals.get(p.source) ?? 0) <= 0) continue;
        const row = byTime.get(p.t) ?? { t: p.t };
        row[p.source] = ((row[p.source] as number | undefined) ?? 0) + p.tokens;
        byTime.set(p.t, row);
      }
      return {
        keys,
        data: [...byTime.values()].sort((a, b) => Number(a.t) - Number(b.t)),
        labelOf: harnessLabel,
        colorOf: (key: string, _i: number) =>
          HARNESS_COLOR[key as Source] ?? PALETTE[_i % PALETTE.length],
      };
    }

    const totals = new Map<string, number>();
    for (const p of series) {
      const k = modelKey(p);
      totals.set(k, (totals.get(k) ?? 0) + p.tokens);
    }
    const keys = [...totals.entries()]
      .filter(([, tokens]) => tokens > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    const byTime = new Map<number, Record<string, number | string>>();
    for (const p of series) {
      const k = modelKey(p);
      if ((totals.get(k) ?? 0) <= 0) continue;
      const row = byTime.get(p.t) ?? { t: p.t };
      row[k] = ((row[k] as number | undefined) ?? 0) + p.tokens;
      byTime.set(p.t, row);
    }
    return {
      keys,
      data: [...byTime.values()].sort((a, b) => Number(a.t) - Number(b.t)),
      labelOf: modelLabel,
      colorOf: (_key: string, i: number) => PALETTE[i % PALETTE.length],
    };
  }, [series, groupBy]);

  return (
    <div>
      <div className="flex justify-end mb-2">
        <div className="flex rounded-md border border-border overflow-hidden">
          {(
            [
              { id: "model" as const, label: "By model" },
              { id: "harness" as const, label: "By harness" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`focus-ring px-2.5 py-1 text-xs transition-colors duration-150 ${
                groupBy === opt.id ? "bg-accent/20 text-text" : "text-muted hover:text-text"
              }`}
              onClick={() => setGroupBy(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 || keys.length === 0 ? (
        <p className="text-sm text-muted py-8 text-center">No points in this range.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tickFormatter={(t) =>
                  new Date(t).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                  })
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
                formatter={(v, name) => [formatTokens(Number(v)), labelOf(String(name))]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                formatter={(value) => labelOf(String(value))}
              />
              {keys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={colorOf(key, i)}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
