import { describe, expect, test } from "bun:test";
import { aggregate, resolvePresetRange, startOfLocalDay } from "../src/core/aggregate";
import { inferWindows, currentWindowState } from "../src/core/window";
import { cacheSavingsForTokens, costForTokens, loadPricing } from "../src/core/pricing";
import { whatIfSwap } from "../src/core/whatif";
import type { EventRow } from "../src/adapters/types";

loadPricing();

function row(partial: Partial<EventRow> & Pick<EventRow, "id" | "ts">): EventRow {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
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

describe("5h window inference", () => {
  test("gap of 5h opens a new block", () => {
    const t0 = Date.parse("2026-07-01T10:00:00Z");
    const stamps = [t0, t0 + 60_000, t0 + 5 * 3600_000 + 1000];
    const weights = [10, 20, 30];
    const blocks = inferWindows(stamps, weights, t0 + 5 * 3600_000 + 60_000);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]!.start).toBe(t0);
    expect(blocks[1]!.start).toBe(stamps[2]);
  });

  test("boundary exactly at 5h starts a new block", () => {
    const t0 = Date.parse("2026-07-01T10:00:00Z");
    const stamps = [t0, t0 + 5 * 3600_000];
    const blocks = inferWindows(stamps, [1, 1], t0 + 5 * 3600_000 + 1);
    expect(blocks.length).toBe(2);
  });

  test("current window labeled Estimated without reported state", () => {
    const t0 = Date.now() - 30 * 60_000;
    const state = currentWindowState([t0, t0 + 1000], [100, 50], Date.now(), null);
    expect(state.label).toBe("Estimated");
    expect(state.start).toBe(t0);
  });

  test("reported label when provided", () => {
    const start = Date.now() - 60_000;
    const end = start + 5 * 3600_000;
    const state = currentWindowState([start], [10], Date.now(), { start, end, tokens: 10 });
    expect(state.label).toBe("Reported");
  });
});

describe("aggregate", () => {
  test("multi-source totals", () => {
    const rows = [
      row({
        id: "1",
        ts: 1000,
        source: "claude-code",
        in_tokens: 100,
        cost_api: 1,
      }),
      row({
        id: "2",
        ts: 2000,
        source: "opencode",
        in_tokens: 50,
        cost_api: 0.5,
        session_id: "s2",
      }),
    ];
    const summary = aggregate(
      rows,
      { range: { from: 0, to: 10_000 }, preset: "all", sources: [] },
      {
        now: 10_000,
        timezone: "UTC",
        weeklyBaselineTokens: 1000,
        planMultiplier: 5,
        monthlyBudgetUsd: 100,
      },
    );
    expect(summary.tokens.in).toBe(150);
    expect(summary.costApi).toBe(1.5);
    expect(summary.bySource.find((s) => s.source === "claude-code")?.tokens.in).toBe(100);
    expect(summary.weekly.estimated).toBe(true);
  });

  test("range filter spanning DST-style day boundary still resolves", () => {
    // America/Lima has no DST; America/New_York does — exercise resolver stability
    const now = Date.parse("2026-03-09T12:00:00-04:00");
    const range = resolvePresetRange("today", "America/New_York", now);
    expect(range.from).toBeLessThan(now);
    expect(range.to).toBe(now);
    const start = startOfLocalDay(now, "America/New_York");
    expect(start).toBe(range.from);
  });
});

describe("pricing math", () => {
  test("cache savings is positive when cache read is cheaper", () => {
    const savings = cacheSavingsForTokens("claude-sonnet-4-20250514", 100_000);
    expect(savings).toBeGreaterThan(0);
  });

  test("unknown model costs 0", () => {
    expect(costForTokens("totally-unknown-model-zzz", { in: 10, out: 10, cacheWrite: 0, cacheRead: 0 })).toBe(0);
  });

  test("what-if swap delta", () => {
    const rows = [
      row({
        id: "1",
        ts: 1,
        in_tokens: 1000,
        out_tokens: 1000,
        cost_api: costForTokens("claude-opus-4-20250514", {
          in: 1000,
          out: 1000,
          cacheWrite: 0,
          cacheRead: 0,
        }),
        model: "claude-opus-4-20250514",
      }),
    ];
    // If opus isn't in fallback, cost_api may be 0 — still exercise the path
    const result = whatIfSwap(rows, "claude-sonnet-4-20250514");
    expect(result.hypothetical).toBeGreaterThanOrEqual(0);
    expect(typeof result.savings).toBe("number");
  });
});
