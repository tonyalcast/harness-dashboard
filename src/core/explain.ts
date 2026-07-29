import type { EventRow, Filter, Source } from "../adapters/types";
import {
  cacheSavingsForTokens,
  lookupPriceDetail,
  pricingProvenance,
  type PriceMatch,
} from "./pricing";

/** Which raw field in each harness's own files becomes which token bucket. */
export type FieldMap = {
  source: Source;
  origin: string;
  format: string;
  fields: Array<{ bucket: "in" | "out" | "cacheWrite" | "cacheRead"; from: string }>;
  caveat?: string;
};

export const FIELD_MAPS: FieldMap[] = [
  {
    source: "claude-code",
    origin: "~/.claude/projects/**/*.jsonl",
    format: "One JSON object per line; we read only lines where type === \"assistant\".",
    fields: [
      { bucket: "in", from: "message.usage.input_tokens" },
      { bucket: "out", from: "message.usage.output_tokens" },
      { bucket: "cacheWrite", from: "message.usage.cache_creation_input_tokens" },
      { bucket: "cacheRead", from: "message.usage.cache_read_input_tokens" },
    ],
    caveat:
      "Deduplicated by message id (falling back to uuid), so re-reading a file never double-counts.",
  },
  {
    source: "opencode",
    origin: "~/.local/share/opencode/**/msg_*.json",
    format: "One JSON file per message; we read only role === \"assistant\".",
    fields: [
      { bucket: "in", from: "tokens.input" },
      { bucket: "out", from: "tokens.output + tokens.reasoning" },
      { bucket: "cacheWrite", from: "tokens.cache.write" },
      { bucket: "cacheRead", from: "tokens.cache.read" },
    ],
    caveat:
      "OpenCode often writes cost: 0 on messages that used real tokens. We treat that as missing, not free, so Reported stays blank rather than wrong.",
  },
  {
    source: "cursor",
    origin: "Cursor account API (only when CURSOR_SESSION_COOKIE is set)",
    format: "Coarse per-model monthly totals — not per message.",
    fields: [
      { bucket: "in", from: "inputTokens (or 70% of numTokens when absent)" },
      { bucket: "out", from: "outputTokens (or the remainder of numTokens)" },
      { bucket: "cacheWrite", from: "not reported — always 0" },
      { bucket: "cacheRead", from: "not reported — always 0" },
    ],
    caveat:
      "When Cursor reports only a lump total, the in/out split is estimated at 70/30. Treat these rows as limited data.",
  },
];

export type CostLine = {
  bucket: "in" | "out" | "cacheWrite" | "cacheRead";
  label: string;
  tokens: number;
  /** USD per token, as stored in the rate table. */
  rate: number;
  /** Same rate expressed per million tokens — what the UI shows. */
  ratePerMillion: number;
  subtotal: number;
  /** True when the rate table had no cache price and we derived it from input. */
  derived?: boolean;
};

export type ModelBreakdown = {
  model: string;
  events: number;
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number; total: number };
  priced: boolean;
  matchedKey: string | null;
  matchedHow: PriceMatch["how"] | null;
  lines: CostLine[];
  costApi: number;
  cacheSavings: number;
  costReported: number | null;
  reportedEvents: number;
};

export type Explain = {
  filter: Filter;
  generatedAt: number;
  rateTable: ReturnType<typeof pricingProvenance>;
  fieldMaps: FieldMap[];
  events: {
    inRange: number;
    bySource: Array<{ source: Source; events: number; sessions: number; tokens: number }>;
  };
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number; total: number };
  models: ModelBreakdown[];
  totals: {
    costApi: number;
    cacheSavings: number;
    costReported: number | null;
    reportedEvents: number;
    unpricedTokens: number;
  };
};

const BUCKETS = [
  { bucket: "in", label: "Input", col: "in_tokens", rateKey: "input" },
  { bucket: "out", label: "Output", col: "out_tokens", rateKey: "output" },
  { bucket: "cacheWrite", label: "Cache write", col: "cache_write", rateKey: "cacheWrite" },
  { bucket: "cacheRead", label: "Cache read", col: "cache_read", rateKey: "cacheRead" },
] as const;

export function buildExplain(rows: EventRow[], filter: Filter, now = Date.now()): Explain {
  const tokens = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  const bySource = new Map<Source, { events: number; sessions: Set<string>; tokens: number }>();
  const byModel = new Map<string, EventRow[]>();

  for (const r of rows) {
    tokens.in += r.in_tokens;
    tokens.out += r.out_tokens;
    tokens.cacheWrite += r.cache_write;
    tokens.cacheRead += r.cache_read;

    const rowTotal = r.in_tokens + r.out_tokens + r.cache_write + r.cache_read;
    const s = bySource.get(r.source) ?? { events: 0, sessions: new Set<string>(), tokens: 0 };
    s.events++;
    s.sessions.add(r.session_id);
    s.tokens += rowTotal;
    bySource.set(r.source, s);

    const m = byModel.get(r.model) ?? [];
    m.push(r);
    byModel.set(r.model, m);
  }
  tokens.total = tokens.in + tokens.out + tokens.cacheWrite + tokens.cacheRead;

  const models: ModelBreakdown[] = [];
  for (const [model, evs] of byModel) {
    const t = { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    let costReported: number | null = null;
    let reportedEvents = 0;
    for (const e of evs) {
      t.in += e.in_tokens;
      t.out += e.out_tokens;
      t.cacheWrite += e.cache_write;
      t.cacheRead += e.cache_read;
      if (e.cost_reported != null) {
        costReported = (costReported ?? 0) + e.cost_reported;
        reportedEvents++;
      }
    }
    t.total = t.in + t.out + t.cacheWrite + t.cacheRead;

    const match = lookupPriceDetail(model);
    const lines: CostLine[] = BUCKETS.map((b) => {
      const rate = match ? match.price[b.rateKey] : 0;
      const count = t[b.bucket];
      return {
        bucket: b.bucket,
        label: b.label,
        tokens: count,
        rate,
        ratePerMillion: rate * 1_000_000,
        subtotal: count * rate,
        derived:
          b.bucket === "cacheWrite"
            ? match?.price.cacheWriteDerived
            : b.bucket === "cacheRead"
              ? match?.price.cacheReadDerived
              : undefined,
      };
    });

    models.push({
      model,
      events: evs.length,
      tokens: t,
      priced: match != null,
      matchedKey: match?.matchedKey ?? null,
      matchedHow: match?.how ?? null,
      lines,
      costApi: lines.reduce((a, l) => a + l.subtotal, 0),
      cacheSavings: cacheSavingsForTokens(model, t.cacheRead),
      costReported,
      reportedEvents,
    });
  }
  models.sort((a, b) => b.costApi - a.costApi || b.tokens.total - a.tokens.total);

  const reportedEvents = models.reduce((a, m) => a + m.reportedEvents, 0);
  const costReported = models.reduce<number | null>(
    (a, m) => (m.costReported == null ? a : (a ?? 0) + m.costReported),
    null,
  );

  return {
    filter,
    generatedAt: now,
    rateTable: pricingProvenance(),
    fieldMaps: FIELD_MAPS.filter(
      (f) => filter.sources.length === 0 || filter.sources.includes(f.source),
    ),
    events: {
      inRange: rows.length,
      bySource: [...bySource.entries()].map(([source, v]) => ({
        source,
        events: v.events,
        sessions: v.sessions.size,
        tokens: v.tokens,
      })),
    },
    tokens,
    models,
    totals: {
      costApi: models.reduce((a, m) => a + m.costApi, 0),
      cacheSavings: models.reduce((a, m) => a + m.cacheSavings, 0),
      costReported,
      reportedEvents,
      unpricedTokens: models.filter((m) => !m.priced).reduce((a, m) => a + m.tokens.total, 0),
    },
  };
}
