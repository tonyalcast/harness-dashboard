import type { EventRow, Filter, Source } from "../adapters/types";
import { cacheSavingsForTokens, costForTokens, whatIfCost } from "./pricing";
import { inferWindows, type WindowBlock } from "./window";

export type TokenBreakdown = {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
};

export type SummaryView = {
  filter: Filter;
  tokens: TokenBreakdown;
  costApi: number;
  costReported: number | null;
  cacheSavings: number;
  bySource: Array<{
    source: Source;
    tokens: TokenBreakdown;
    costApi: number;
    costReported: number | null;
    sessions: number;
  }>;
  byModel: Array<{
    model: string;
    tokens: TokenBreakdown;
    costApi: number;
    share: number;
    events: number;
  }>;
  series: Array<{ t: number; tokens: number; costApi: number; source: Source }>;
  topSessions: Array<{
    sessionId: string;
    source: Source;
    project: string | null;
    model: string;
    tokens: TokenBreakdown;
    costApi: number;
    costReported: number | null;
    start: number;
    end: number;
  }>;
  heatmap: Array<{ day: string; tokens: number }>; // YYYY-MM-DD in local tz
  blockTimeline: WindowBlock[];
  weekly: {
    tokens: number;
    baseline: number;
    pct: number | null;
    estimated: true;
    calibrated: boolean;
  };
  budget: {
    monthlyBudgetUsd: number;
    spentApi: number;
    pct: number | null;
  };
  unpricedModels: string[];
  whatIf: {
    currentCost: number;
    models: string[];
  };
  limitedData: boolean;
};

const FIVE_H = 5 * 60 * 60 * 1000;

export function rowsToTokens(rows: EventRow[]): TokenBreakdown {
  let inn = 0,
    out = 0,
    cw = 0,
    cr = 0;
  for (const r of rows) {
    inn += r.in_tokens;
    out += r.out_tokens;
    cw += r.cache_write;
    cr += r.cache_read;
  }
  return { in: inn, out, cacheWrite: cw, cacheRead: cr, total: inn + out + cw + cr };
}

export function sumReported(rows: EventRow[]): number | null {
  let any = false;
  let sum = 0;
  for (const r of rows) {
    if (r.cost_reported != null) {
      any = true;
      sum += r.cost_reported;
    }
  }
  return any ? sum : null;
}

export function aggregate(
  rows: EventRow[],
  filter: Filter,
  opts: {
    now: number;
    timezone: string;
    weeklyBaselineTokens: number;
    planMultiplier: number;
    monthlyBudgetUsd: number;
    unpricedModels?: string[];
  },
): SummaryView {
  const tokens = rowsToTokens(rows);
  const costApi = rows.reduce((s, r) => s + r.cost_api, 0);
  const costReported = sumReported(rows);

  let cacheSavings = 0;
  for (const r of rows) {
    cacheSavings += cacheSavingsForTokens(r.model, r.cache_read);
  }

  const bySourceMap = new Map<
    Source,
    { rows: EventRow[]; sessions: Set<string> }
  >();
  for (const r of rows) {
    let g = bySourceMap.get(r.source);
    if (!g) {
      g = { rows: [], sessions: new Set() };
      bySourceMap.set(r.source, g);
    }
    g.rows.push(r);
    g.sessions.add(r.session_id);
  }
  const bySource = (["claude-code", "opencode", "cursor"] as Source[]).map((source) => {
    const g = bySourceMap.get(source);
    const rs = g?.rows ?? [];
    return {
      source,
      tokens: rowsToTokens(rs),
      costApi: rs.reduce((s, r) => s + r.cost_api, 0),
      costReported: sumReported(rs),
      sessions: g?.sessions.size ?? 0,
    };
  });

  const byModelMap = new Map<string, EventRow[]>();
  for (const r of rows) {
    const list = byModelMap.get(r.model) ?? [];
    list.push(r);
    byModelMap.set(r.model, list);
  }
  const byModel = [...byModelMap.entries()]
    .map(([model, rs]) => {
      const t = rowsToTokens(rs);
      const c = rs.reduce((s, r) => s + r.cost_api, 0);
      return {
        model,
        tokens: t,
        costApi: c,
        share: costApi > 0 ? c / costApi : 0,
        events: rs.length,
      };
    })
    .sort((a, b) => b.costApi - a.costApi);

  // Hourly series for charts
  const bucketMs = pickBucket(filter.range.from, filter.range.to);
  const seriesMap = new Map<string, { t: number; tokens: number; costApi: number; source: Source }>();
  for (const r of rows) {
    const t = Math.floor(r.ts / bucketMs) * bucketMs;
    const key = `${t}|${r.source}`;
    const cur = seriesMap.get(key) ?? { t, tokens: 0, costApi: 0, source: r.source };
    cur.tokens += r.in_tokens + r.out_tokens + r.cache_write + r.cache_read;
    cur.costApi += r.cost_api;
    seriesMap.set(key, cur);
  }
  const series = [...seriesMap.values()].sort((a, b) => a.t - b.t);

  // Top sessions
  const sessMap = new Map<string, EventRow[]>();
  for (const r of rows) {
    const key = `${r.source}|${r.session_id}`;
    const list = sessMap.get(key) ?? [];
    list.push(r);
    sessMap.set(key, list);
  }
  const topSessions = [...sessMap.values()]
    .map((rs) => {
      const first = rs[0]!;
      const t = rowsToTokens(rs);
      return {
        sessionId: first.session_id,
        source: first.source,
        project: first.project,
        model: mode(rs.map((r) => r.model)),
        tokens: t,
        costApi: rs.reduce((s, r) => s + r.cost_api, 0),
        costReported: sumReported(rs),
        start: Math.min(...rs.map((r) => r.ts)),
        end: Math.max(...rs.map((r) => r.ts)),
      };
    })
    .sort((a, b) => b.costApi - a.costApi)
    .slice(0, 20);

  const heatmap = buildHeatmap(rows, opts.timezone, opts.now);
  const dayStart = startOfLocalDay(opts.now, opts.timezone);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  const todayRows = rows.filter((r) => r.ts >= dayStart && r.ts <= dayEnd);
  const blockTimeline = inferWindows(
    todayRows.map((r) => r.ts),
    todayRows.map((r) => r.in_tokens + r.out_tokens + r.cache_write + r.cache_read),
    opts.now,
    FIVE_H,
  );

  const weekFrom = opts.now - 7 * 24 * 60 * 60 * 1000;
  const weekTokens = rows
    .filter((r) => r.ts >= weekFrom && r.ts <= opts.now)
    .reduce((s, r) => s + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read, 0);
  // If filter already is the full set for weekly, recompute from all rows passed in when range covers week
  const weeklyTokensInScope = rows
    .filter((r) => r.ts >= weekFrom && r.ts <= opts.now)
    .reduce((s, r) => s + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read, 0);
  const baseline =
    opts.weeklyBaselineTokens > 0 ? opts.weeklyBaselineTokens * opts.planMultiplier : 0;
  const calibrated = opts.weeklyBaselineTokens > 0;
  const weeklyPct = calibrated && baseline > 0 ? (weeklyTokensInScope / baseline) * 100 : null;

  const monthStart = startOfLocalMonth(opts.now, opts.timezone);
  const monthSpend = rows
    .filter((r) => r.ts >= monthStart)
    .reduce((s, r) => s + r.cost_api, 0);

  const models = byModel.map((m) => m.model);

  return {
    filter,
    tokens,
    costApi,
    costReported,
    cacheSavings,
    bySource,
    byModel,
    series,
    topSessions,
    heatmap,
    blockTimeline,
    weekly: {
      tokens: weeklyTokensInScope || weekTokens,
      baseline,
      pct: weeklyPct,
      estimated: true,
      calibrated,
    },
    budget: {
      monthlyBudgetUsd: opts.monthlyBudgetUsd,
      spentApi: monthSpend,
      pct: opts.monthlyBudgetUsd > 0 ? (monthSpend / opts.monthlyBudgetUsd) * 100 : null,
    },
    unpricedModels: opts.unpricedModels ?? [],
    whatIf: { currentCost: costApi, models },
    limitedData: rows.some((r) => r.source === "cursor"),
  };
}

export function computeWhatIf(
  rows: EventRow[],
  targetModel: string,
): { current: number; hypothetical: number; delta: number } {
  let current = 0;
  let hypothetical = 0;
  for (const r of rows) {
    current += r.cost_api;
    hypothetical += whatIfCost(
      {
        in: r.in_tokens,
        out: r.out_tokens,
        cacheWrite: r.cache_write,
        cacheRead: r.cache_read,
      },
      targetModel,
    );
  }
  return { current, hypothetical, delta: current - hypothetical };
}

function pickBucket(from: number, to: number): number {
  const span = to - from;
  const day = 24 * 60 * 60 * 1000;
  if (span <= day) return 60 * 60 * 1000;
  if (span <= 7 * day) return 6 * 60 * 60 * 1000;
  if (span <= 31 * day) return day;
  return 7 * day;
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "unknown";
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function buildHeatmap(
  rows: EventRow[],
  timezone: string,
  now: number,
): Array<{ day: string; tokens: number }> {
  const map = new Map<string, number>();
  // 53 weeks back
  const start = now - 53 * 7 * 24 * 60 * 60 * 1000;
  for (const r of rows) {
    if (r.ts < start) continue;
    const day = formatDay(r.ts, timezone);
    map.set(
      day,
      (map.get(day) ?? 0) + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
    );
  }
  return [...map.entries()]
    .map(([day, tokens]) => ({ day, tokens }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function formatDay(ts: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

export function startOfLocalDay(ts: number, timezone: string): number {
  const day = formatDay(ts, timezone);
  // Interpret YYYY-MM-DD midnight in the given timezone
  return zonedMidnight(day, timezone);
}

export function startOfLocalMonth(ts: number, timezone: string): number {
  const day = formatDay(ts, timezone);
  const [y, m] = day.split("-").map(Number);
  return zonedMidnight(`${y}-${String(m).padStart(2, "0")}-01`, timezone);
}

export function resolvePresetRange(
  preset: Filter["preset"],
  timezone: string,
  now: number,
  custom?: { from: number; to: number },
): { from: number; to: number } {
  if (preset === "custom" && custom) return custom;
  const to = now;
  switch (preset) {
    case "today":
      return { from: startOfLocalDay(now, timezone), to };
    case "week":
      return { from: now - 7 * 24 * 60 * 60 * 1000, to };
    case "month":
      return { from: startOfLocalMonth(now, timezone), to };
    case "all":
      return { from: 0, to };
    case "custom":
      return custom ?? { from: startOfLocalDay(now, timezone), to };
  }
}

function zonedMidnight(ymd: string, timezone: string): number {
  // Binary-search UTC ms whose local calendar day is ymd at 00:00
  const [y, m, d] = ymd.split("-").map(Number);
  // Approximate from UTC then refine
  let guess = Date.UTC(y!, m! - 1, d!);
  for (let i = 0; i < 48; i++) {
    const local = formatDay(guess, timezone);
    if (local === ymd) {
      // Step back to the first ms of this local day
      while (formatDay(guess - 1, timezone) === ymd) guess--;
      return guess;
    }
    if (local < ymd) guess += 60 * 60 * 1000;
    else guess -= 60 * 60 * 1000;
  }
  return Date.UTC(y!, m! - 1, d!);
}

// Re-export for what-if unit tests
void costForTokens;
