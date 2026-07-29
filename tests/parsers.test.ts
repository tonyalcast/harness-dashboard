import { describe, expect, test } from "bun:test";
import { parseLine } from "../src/adapters/claude-code";
import { makeEventId } from "../src/adapters/util";
import { normalizeOpenCodeModel } from "../src/adapters/opencode";
import { parseCursorPayload } from "../src/adapters/cursor";

describe("claude parseLine", () => {
  test("dedupes by message.id + requestId", () => {
    const a = makeEventId("claude-code", "sess", "msg_same", "req_dup");
    const b = makeEventId("claude-code", "sess", "msg_same", "req_dup");
    expect(a).toBe(b);
  });

  test("different request ids differ", () => {
    const a = makeEventId("claude-code", "sess", "msg_same", "req_1");
    const b = makeEventId("claude-code", "sess", "msg_same", "req_2");
    expect(a).not.toBe(b);
  });

  test("skips malformed by throwing to caller", () => {
    expect(() => parseLine("not-json", "s", "/p")).toThrow();
  });

  test("parses real fixture lines and collapses duplicates", async () => {
    const text = await Bun.file("tests/fixtures/claude-dup-malformed.jsonl").text();
    const events = [];
    let skipped = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = parseLine(line, "sess-dup", "/proj");
        if (ev) events.push(ev);
      } catch {
        skipped++;
      }
    }
    expect(skipped).toBe(1);
    const ids = new Set(events.map((e) => e.id));
    // Two duplicate usage lines share one id; third is unique
    expect(ids.size).toBe(2);
    expect(events.length).toBe(3);
  });

  test("normal session fixture", async () => {
    const text = await Bun.file("tests/fixtures/claude-normal.jsonl").text();
    const events = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = parseLine(line, "sess-normal", "/Users/you/app");
        if (ev) events.push(ev);
      } catch {
        /* skip */
      }
    }
    expect(events.length).toBe(2);
    expect(events[0]!.tokens.in).toBe(100);
    expect(events[0]!.tokens.cacheRead).toBe(200);
  });
});

describe("opencode model normalize", () => {
  test("strips capability suffix", () => {
    expect(normalizeOpenCodeModel("claude-sonnet-4-high")).toBe("claude-sonnet-4");
  });
});

describe("cursor payload", () => {
  test("parses coarse model rows", () => {
    const events = parseCursorPayload({
      startOfMonth: "2026-07-01T00:00:00.000Z",
      "gpt-4": { numRequests: 3, numTokens: 1000 },
      ignored: "x",
    });
    expect(events.length).toBe(1);
    expect(events[0]!.limited).toBe(true);
    expect(events[0]!.tokens.in + events[0]!.tokens.out).toBe(1000);
  });

  test("parses spending usage event rows for the chart", async () => {
    const { parseCursorUsageEventRows } = await import("../src/adapters/cursor");
    const events = parseCursorUsageEventRows([
      {
        timestamp: "1785357847478",
        model: "cursor-grok-4.5-high-fast",
        conversationId: "abc",
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 50,
          totalCents: 12.5,
        },
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe("cursor");
    expect(events[0]!.model).toBe("cursor-grok-4.5-high-fast");
    expect(events[0]!.tokens).toEqual({ in: 100, out: 20, cacheWrite: 0, cacheRead: 50 });
    expect(events[0]!.costReported).toBeCloseTo(0.125, 6);
    expect(events[0]!.limited).toBeUndefined();
  });
});
