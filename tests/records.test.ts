import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

// Must be set before anything imports config.ts, or these tests would run
// clearEvents() against the real ~/.harness-dashboard index.
const tmp = join(import.meta.dir, ".tmp-records");
mkdirSync(tmp, { recursive: true });
process.env.HARNESS_DASHBOARD_DATA_DIR = tmp;

const { queryRecords, recordTotals } = await import("../src/db/query");
const { clearEvents, insertEvents } = await import("../src/db/ingest");
const { closeDb, dbPath } = await import("../src/db/schema");
type RecordQuery = Parameters<typeof queryRecords>[0];
import type { Filter, UsageEvent } from "../src/adapters/types";

function ev(p: Partial<UsageEvent> & Pick<UsageEvent, "id" | "ts">): UsageEvent {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    sessionId: "s1",
    project: "/alpha",
    tokens: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0 },
    ...p,
  };
}

const ALL: Filter = { range: { from: 0, to: 1e13 }, preset: "all", sources: [] };
const q = (over: Partial<RecordQuery> = {}): RecordQuery => ({ filter: ALL, ...over });

beforeAll(() => {
  // Guard: never let a misconfigured env point these destructive tests at real data.
  expect(dbPath().startsWith(tmp)).toBe(true);
  clearEvents();
  insertEvents([
    ev({ id: "r1", ts: 1000, tokens: { in: 100, out: 10, cacheWrite: 0, cacheRead: 0 } }),
    ev({
      id: "r2",
      ts: 2000,
      source: "opencode",
      model: "gpt-5-nano",
      sessionId: "s2",
      project: "/beta",
      tokens: { in: 5000, out: 900, cacheWrite: 0, cacheRead: 0 },
    }),
    ev({
      id: "r3",
      ts: 3000,
      sessionId: "s3",
      tokens: { in: 20, out: 5, cacheWrite: 40, cacheRead: 900 },
      costReported: 0.05,
    }),
  ]);
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe("queryRecords", () => {
  test("defaults to newest first", () => {
    expect(queryRecords(q()).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
  });

  test("sorts ascending when asked", () => {
    expect(queryRecords(q({ dir: "asc" })).map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  test("sorts by total tokens, not by any single bucket", () => {
    const ids = queryRecords(q({ sort: "tokens", dir: "desc" })).map((r) => r.id);
    expect(ids[0]).toBe("r2"); // 5900 total
  });

  test("paginates without overlapping or dropping rows", () => {
    const p1 = queryRecords(q({ limit: 2, offset: 0 })).map((r) => r.id);
    const p2 = queryRecords(q({ limit: 2, offset: 2 })).map((r) => r.id);
    expect(p1).toHaveLength(2);
    expect(p2).toHaveLength(1);
    expect(new Set([...p1, ...p2]).size).toBe(3);
  });

  test("clamps an absurd page size instead of trusting the client", () => {
    expect(queryRecords(q({ limit: 99999 }))).toHaveLength(3);
    expect(queryRecords(q({ limit: -5 }))).toHaveLength(1);
  });

  test("search matches model, session or project", () => {
    expect(queryRecords(q({ search: "gpt-5" })).map((r) => r.id)).toEqual(["r2"]);
    expect(queryRecords(q({ search: "s3" })).map((r) => r.id)).toEqual(["r3"]);
    expect(queryRecords(q({ search: "/beta" })).map((r) => r.id)).toEqual(["r2"]);
  });

  test("filters by source and by range", () => {
    expect(
      queryRecords(q({ filter: { ...ALL, sources: ["opencode"] } })).map((r) => r.id),
    ).toEqual(["r2"]);
    expect(
      queryRecords(q({ filter: { ...ALL, range: { from: 2500, to: 1e13 } } })).map((r) => r.id),
    ).toEqual(["r3"]);
  });
});

describe("recordTotals", () => {
  test("totals cover the whole filtered set, not just the visible page", () => {
    const t = recordTotals(q({ limit: 1 }));
    expect(t.rows).toBe(3);
    expect(t.tokens).toBe(110 + 5900 + 965);
  });

  test("respects search and source filters", () => {
    expect(recordTotals(q({ search: "gpt-5" })).rows).toBe(1);
    expect(recordTotals(q({ filter: { ...ALL, sources: ["opencode"] } })).tokens).toBe(5900);
  });

  test("reported cost counts only rows that carried one", () => {
    const t = recordTotals(q());
    expect(t.reportedRows).toBe(1);
    expect(t.costReported).toBeCloseTo(0.05, 12);
  });

  test("an empty match yields zeroes and a null reported total", () => {
    const t = recordTotals(q({ search: "nothing-matches-this" }));
    expect(t.rows).toBe(0);
    expect(t.tokens).toBe(0);
    expect(t.costApi).toBe(0);
    expect(t.costReported).toBeNull();
  });
});
