import { describe, expect, test } from "bun:test";
import { buildExplain } from "../src/core/explain";
import { costForTokens, loadPricing, lookupPriceDetail } from "../src/core/pricing";
import type { EventRow, Filter } from "../src/adapters/types";

loadPricing();

const MODEL = "claude-sonnet-4-20250514";

function row(partial: Partial<EventRow> & Pick<EventRow, "id" | "ts">): EventRow {
  return {
    source: "claude-code",
    model: MODEL,
    session_id: "s1",
    project: "/p",
    in_tokens: 0,
    out_tokens: 0,
    cache_write: 0,
    cache_read: 0,
    cost_reported: null,
    cost_api: 0,
    ...partial,
  };
}

const filter: Filter = { range: { from: 0, to: 1e13 }, preset: "all", sources: [] };

describe("buildExplain", () => {
  const rows = [
    row({ id: "a", ts: 100, in_tokens: 1000, out_tokens: 500, cache_write: 200, cache_read: 8000 }),
    row({
      id: "b",
      ts: 200,
      session_id: "s2",
      in_tokens: 300,
      out_tokens: 100,
      cost_reported: 0.02,
    }),
  ];

  test("token total is the plain sum of the four buckets", () => {
    const e = buildExplain(rows, filter);
    expect(e.tokens.in).toBe(1300);
    expect(e.tokens.out).toBe(600);
    expect(e.tokens.cacheWrite).toBe(200);
    expect(e.tokens.cacheRead).toBe(8000);
    expect(e.tokens.total).toBe(1300 + 600 + 200 + 8000);
  });

  test("per-line subtotals sum to the same cost the dashboard shows", () => {
    const e = buildExplain(rows, filter);
    const m = e.models[0]!;
    const lineSum = m.lines.reduce((a, l) => a + l.subtotal, 0);
    expect(m.costApi).toBeCloseTo(lineSum, 12);
    // Must agree with the aggregate pricing path, or the view would be lying.
    expect(m.costApi).toBeCloseTo(
      costForTokens(MODEL, { in: 1300, out: 600, cacheWrite: 200, cacheRead: 8000 }),
      12,
    );
    expect(e.totals.costApi).toBeCloseTo(m.costApi, 12);
  });

  test("each line is tokens x rate, and rate/1M is the same rate scaled", () => {
    const e = buildExplain(rows, filter);
    const m = e.models[0]!;
    for (const l of m.lines) {
      expect(l.subtotal).toBeCloseTo(l.tokens * l.rate, 12);
      expect(l.ratePerMillion).toBeCloseTo(l.rate * 1_000_000, 12);
    }
  });

  test("reports which rate-table key was matched and how", () => {
    const e = buildExplain(rows, filter);
    const m = e.models[0]!;
    expect(m.priced).toBe(true);
    expect(m.matchedKey).toBe(lookupPriceDetail(MODEL)!.matchedKey);
    expect(m.matchedHow).not.toBeNull();
  });

  test("counts events and sessions per source", () => {
    const e = buildExplain(rows, filter);
    expect(e.events.inRange).toBe(2);
    const cc = e.events.bySource.find((s) => s.source === "claude-code")!;
    expect(cc.events).toBe(2);
    expect(cc.sessions).toBe(2);
    expect(cc.tokens).toBe(10100);
  });

  test("reported cost only counts events that actually carried one", () => {
    const e = buildExplain(rows, filter);
    expect(e.totals.reportedEvents).toBe(1);
    expect(e.totals.costReported).toBeCloseTo(0.02, 12);
  });

  test("reported stays null when no event reported a cost — never fabricated", () => {
    const e = buildExplain([rows[0]!], filter);
    expect(e.totals.costReported).toBeNull();
    expect(e.totals.reportedEvents).toBe(0);
  });

  test("unpriced models cost $0 but keep their tokens visible", () => {
    const e = buildExplain(
      [row({ id: "z", ts: 1, model: "totally-made-up-model", in_tokens: 5000 })],
      filter,
    );
    const m = e.models[0]!;
    expect(m.priced).toBe(false);
    expect(m.matchedKey).toBeNull();
    expect(m.costApi).toBe(0);
    expect(m.tokens.total).toBe(5000);
    expect(e.totals.unpricedTokens).toBe(5000);
    expect(e.tokens.total).toBe(5000);
  });

  test("field maps narrow to the filtered sources", () => {
    const e = buildExplain(rows, { ...filter, sources: ["opencode"] });
    expect(e.fieldMaps.map((f) => f.source)).toEqual(["opencode"]);
    expect(buildExplain(rows, filter).fieldMaps).toHaveLength(3);
  });

  test("empty range yields zeroes, not NaN", () => {
    const e = buildExplain([], filter);
    expect(e.tokens.total).toBe(0);
    expect(e.totals.costApi).toBe(0);
    expect(e.totals.cacheSavings).toBe(0);
    expect(e.models).toHaveLength(0);
  });
});
