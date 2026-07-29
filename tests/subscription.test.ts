import { describe, expect, test } from "bun:test";
import { __parse, subscriptionConfigured } from "../src/adapters/claude-subscription";

const { findBuckets, findPlan, toEpoch } = __parse;

describe("subscription payload parsing", () => {
  test("reads a 0-100 utilization with a reset timestamp", () => {
    const b = findBuckets({
      five_hour: { utilization: 42, resets_at: "2026-07-29T20:00:00.000Z" },
    });
    const five = b.find((x) => x.key === "five_hour")!;
    expect(five.pct).toBe(42);
    expect(five.resetsAt).toBe(Date.parse("2026-07-29T20:00:00.000Z"));
  });

  test("scales a 0-1 utilization up to a percentage", () => {
    const b = findBuckets({ seven_day: { utilization: 0.73 } });
    expect(b[0]!.pct).toBeCloseTo(73, 6);
  });

  test("does not rescale a used/limit pair that happens to be small", () => {
    // utilization 0.5 here is a real 0.5%, because used/limit disambiguates it.
    const b = findBuckets({ w: { utilization: 0.5, used: 5, limit: 1000 } });
    expect(b[0]!.pct).toBe(0.5);
  });

  test("derives a percentage from used and limit when none is given", () => {
    const b = findBuckets({ weekly: { used: 250, limit: 1000 } });
    expect(b[0]!.pct).toBeCloseTo(25, 6);
    expect(b[0]!.used).toBe(250);
    expect(b[0]!.limit).toBe(1000);
  });

  test("never divides by a zero limit", () => {
    const b = findBuckets({ weekly: { used: 5, limit: 0 } });
    expect(b[0]!.pct).toBeNull();
  });

  test("finds buckets nested inside arrays and objects", () => {
    const b = findBuckets({
      limits: [
        { name: "5h", utilization: 10 },
        { name: "7d", utilization: 20 },
      ],
    });
    expect(b.map((x) => x.pct)).toEqual([10, 20]);
    expect(b[0]!.key).toBe("limits[0]");
  });

  test("ignores objects that carry no limit-shaped fields", () => {
    expect(findBuckets({ user: { name: "x", email: "y" } })).toHaveLength(0);
  });

  test("survives an unrecognised shape instead of throwing", () => {
    expect(findBuckets(null)).toEqual([]);
    expect(findBuckets("nope")).toEqual([]);
    expect(findBuckets({ deeply: { nested: { junk: true } } })).toEqual([]);
  });

  test("does not loop forever on a self-referencing payload", () => {
    const o: Record<string, unknown> = { utilization: 5 };
    o.self = o;
    expect(() => findBuckets(o)).not.toThrow();
  });

  test("reads epoch seconds and milliseconds alike", () => {
    expect(toEpoch(1785350400)).toBe(1785350400000);
    expect(toEpoch(1785350400000)).toBe(1785350400000);
    expect(toEpoch("not a date")).toBeNull();
    expect(toEpoch(null)).toBeNull();
  });

  test("finds the plan name whether it is a string or an object", () => {
    expect(findPlan({ plan: "max_5x" })).toBe("max_5x");
    expect(findPlan({ subscription: { name: "Pro" } })).toBe("Pro");
    expect(findPlan({ nothing: 1 })).toBeNull();
  });
});

describe("configuration gate", () => {
  test("stays disabled unless both cookie and org id are set", () => {
    const prevCookie = process.env.CLAUDE_SESSION_COOKIE;
    const prevOrg = process.env.CLAUDE_ORG_ID;
    try {
      delete process.env.CLAUDE_SESSION_COOKIE;
      delete process.env.CLAUDE_ORG_ID;
      expect(subscriptionConfigured()).toBe(false);

      process.env.CLAUDE_SESSION_COOKIE = "x";
      expect(subscriptionConfigured()).toBe(false);

      process.env.CLAUDE_ORG_ID = "org";
      expect(subscriptionConfigured()).toBe(true);

      process.env.CLAUDE_SESSION_COOKIE = "   ";
      expect(subscriptionConfigured()).toBe(false);
    } finally {
      if (prevCookie === undefined) delete process.env.CLAUDE_SESSION_COOKIE;
      else process.env.CLAUDE_SESSION_COOKIE = prevCookie;
      if (prevOrg === undefined) delete process.env.CLAUDE_ORG_ID;
      else process.env.CLAUDE_ORG_ID = prevOrg;
    }
  });
});

describe("per-harness report", () => {
  test("always returns all three harnesses in a stable order", async () => {
    const { buildSubscriptionReport } = await import("../src/core/subscription");
    const r = await buildSubscriptionReport();
    expect(r.sources.map((s) => s.source)).toEqual(["claude-code", "opencode", "cursor"]);
  });

  test("OpenCode reports no quota rather than a fake zero when unconfigured", async () => {
    const prev = {
      w: process.env.OPENCODE_GO_WORKSPACE_ID,
      c: process.env.OPENCODE_GO_AUTH_COOKIE,
    };
    try {
      delete process.env.OPENCODE_GO_WORKSPACE_ID;
      delete process.env.OPENCODE_GO_AUTH_COOKIE;
      const { buildSubscriptionReport } = await import("../src/core/subscription");
      const oc = (await buildSubscriptionReport(true)).sources.find(
        (s) => s.source === "opencode",
      )!;
      expect(oc.status).toBe("disabled");
      expect(oc.buckets).toEqual([]);
      expect(oc.message).toContain("OPENCODE_GO");
    } finally {
      if (prev.w === undefined) delete process.env.OPENCODE_GO_WORKSPACE_ID;
      else process.env.OPENCODE_GO_WORKSPACE_ID = prev.w;
      if (prev.c === undefined) delete process.env.OPENCODE_GO_AUTH_COOKIE;
      else process.env.OPENCODE_GO_AUTH_COOKIE = prev.c;
    }
  });

  test("unconfigured vendors say so instead of erroring", async () => {
    const prev = {
      c: process.env.CLAUDE_SESSION_COOKIE,
      u: process.env.CURSOR_SESSION_COOKIE,
      ow: process.env.OPENCODE_GO_WORKSPACE_ID,
      oc: process.env.OPENCODE_GO_AUTH_COOKIE,
    };
    try {
      delete process.env.CLAUDE_SESSION_COOKIE;
      delete process.env.CURSOR_SESSION_COOKIE;
      delete process.env.OPENCODE_GO_WORKSPACE_ID;
      delete process.env.OPENCODE_GO_AUTH_COOKIE;
      const { buildSubscriptionReport } = await import("../src/core/subscription");
      const r = await buildSubscriptionReport(true);
      expect(r.sources.find((s) => s.source === "claude-code")!.status).toBe("disabled");
      expect(r.sources.find((s) => s.source === "opencode")!.status).toBe("disabled");
      expect(r.sources.find((s) => s.source === "cursor")!.status).toBe("disabled");
    } finally {
      if (prev.c === undefined) delete process.env.CLAUDE_SESSION_COOKIE;
      else process.env.CLAUDE_SESSION_COOKIE = prev.c;
      if (prev.u === undefined) delete process.env.CURSOR_SESSION_COOKIE;
      else process.env.CURSOR_SESSION_COOKIE = prev.u;
      if (prev.ow === undefined) delete process.env.OPENCODE_GO_WORKSPACE_ID;
      else process.env.OPENCODE_GO_WORKSPACE_ID = prev.ow;
      if (prev.oc === undefined) delete process.env.OPENCODE_GO_AUTH_COOKIE;
      else process.env.OPENCODE_GO_AUTH_COOKIE = prev.oc;
    }
  });

  test("reads Cursor's request quota shape", () => {
    const b = findBuckets({ "gpt-4": { numRequests: 120, maxRequestUsage: 500 } });
    const row = b.find((x) => x.key === "gpt-4")!;
    expect(row.used).toBe(120);
    expect(row.limit).toBe(500);
    expect(row.pct).toBeCloseTo(24, 6);
  });
});

describe("bucket filtering", () => {
  test("drops buckets that carry no percentage and no used/limit pair", async () => {
    const { usefulBuckets } = await import("../src/core/subscription");
    const kept = usefulBuckets([
      { key: "five_hour", pct: 78, used: null, limit: null, resetsAt: 1 },
      { key: "limits[0]", pct: null, used: null, limit: null, resetsAt: 1 },
      { key: "req", pct: null, used: 10, limit: 100, resetsAt: null },
    ]);
    expect(kept.map((b) => b.key)).toEqual(["five_hour", "req"]);
  });

  test("keeps a genuine zero percent rather than treating it as missing", async () => {
    const { usefulBuckets } = await import("../src/core/subscription");
    const kept = usefulBuckets([
      { key: "seven_day", pct: 0, used: null, limit: null, resetsAt: null },
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("cursor endpoint and empty-quota copy", () => {
  test("uses the apex host — www 308-redirects and fetch drops the cookie", async () => {
    const { CURSOR_USAGE_URL } = await import("../src/adapters/cursor");
    expect(CURSOR_USAGE_URL).toBe("https://cursor.com/api/usage");
    expect(CURSOR_USAGE_URL).not.toContain("www.");
  });

  test("spending endpoints also use the apex host", async () => {
    const {
      CURSOR_PERIOD_URL,
      CURSOR_EVENTS_URL,
      CURSOR_HARD_LIMIT_URL,
    } = await import("../src/adapters/cursor-spending");
    for (const url of [CURSOR_PERIOD_URL, CURSOR_EVENTS_URL, CURSOR_HARD_LIMIT_URL]) {
      expect(url.startsWith("https://cursor.com/")).toBe(true);
      expect(url).not.toContain("www.");
    }
  });

  test("explains an authenticated account that simply has no cap", async () => {
    const { describeCursorNoQuota } = await import("../src/core/subscription");
    const msg = describeCursorNoQuota({
      "gpt-4": { numRequests: 12, maxRequestUsage: null },
      "gpt-5": { numRequests: 30, maxRequestUsage: null },
      startOfMonth: "2026-07-17T17:46:20.000Z",
    });
    expect(msg).toContain("42 requests");
    expect(msg).toContain("no request cap");
  });

  test("does not say '1 requests'", async () => {
    const { describeCursorNoQuota } = await import("../src/core/subscription");
    expect(describeCursorNoQuota({ m: { numRequests: 1 } })).toContain("1 request ");
  });

  test("survives a payload with no counts at all", async () => {
    const { describeCursorNoQuota } = await import("../src/core/subscription");
    expect(describeCursorNoQuota({})).toContain("0 requests");
  });
});

describe("cursor spending parser", () => {
  test("maps Included / Other / On-Demand from period usage", async () => {
    const { parseCursorPeriod } = await import("../src/adapters/cursor-spending");
    const period = parseCursorPeriod(
      {
        billingCycleStart: "1784310380000",
        billingCycleEnd: "1786988780000",
        planUsage: {
          autoPercentUsed: 2.35,
          apiPercentUsed: 0,
          totalPercentUsed: 2.04,
        },
        spendLimitUsage: {
          individualLimit: 1600,
          individualRemaining: 1600,
          limitType: "user",
        },
      },
      { hardLimit: 16 },
      { membershipType: "pro" },
    );
    expect(period.plan).toBe("Pro");
    expect(period.hardLimitUsd).toBe(16);
    const included = period.buckets.find((b) => b.key === "included")!;
    const other = period.buckets.find((b) => b.key === "other")!;
    const onDemand = period.buckets.find((b) => b.key === "onDemand")!;
    expect(included.pct).toBeCloseTo(2.35, 5);
    expect(other.pct).toBe(0);
    expect(onDemand.used).toBe(0);
    expect(onDemand.limit).toBe(16);
    expect(onDemand.unit).toBe("usd");
  });

  test("parses included usage events into display rows", async () => {
    const { parseCursorEvents } = await import("../src/adapters/cursor-spending");
    const page = parseCursorEvents(
      {
        totalUsageEventsCount: 1,
        usageEventsDisplay: [
          {
            timestamp: "1785354879980",
            model: "cursor-grok-4.5-high-fast",
            kind: "USAGE_EVENT_KIND_INCLUDED_IN_PRO",
            usageBasedCosts: "-",
            tokenUsage: {
              inputTokens: 1000,
              outputTokens: 200,
              cacheReadTokens: 300,
              totalCents: 12.5,
            },
          },
        ],
      },
      { from: 1, to: 2 },
      "1d",
    );
    expect(page.total).toBe(1);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.type).toBe("Included");
    expect(page.events[0]!.model).toBe("cursor-grok-4.5-high-fast");
    expect(page.events[0]!.tokens).toBe(1500);
    expect(page.events[0]!.costLabel).toBe("Included");
  });

  test("resolves UTC day ranges for event presets", async () => {
    const { resolveEventRange } = await import("../src/adapters/cursor-spending");
    const now = Date.parse("2026-07-29T18:00:00.000Z");
    const day = resolveEventRange("1d", now);
    expect(day.from).toBe(Date.parse("2026-07-29T00:00:00.000Z"));
    expect(day.to).toBe(Date.parse("2026-07-29T23:59:59.999Z"));
    const last = resolveEventRange("last-month", now);
    expect(last.from).toBe(Date.parse("2026-06-01T00:00:00.000Z"));
    expect(last.to).toBe(Date.parse("2026-06-30T23:59:59.999Z"));
  });
});

describe("opencode go subscription parser", () => {
  test("reads rolling / weekly / monthly meters from hydration HTML", async () => {
    const { parseOpenCodeGoHtml, formatResetIn } = await import(
      "../src/adapters/opencode-subscription"
    );
    const html = `
      rollingUsage:$R[31]={status:"ok",resetInSec:18000,usagePercent:0},
      weeklyUsage:$R[32]={status:"ok",resetInSec:359290,usagePercent:0},
      monthlyUsage:$R[33]={status:"ok",resetInSec:591160,usagePercent:52}
    `;
    const buckets = parseOpenCodeGoHtml(html);
    expect(buckets.map((b) => b.key)).toEqual(["continuous", "weekly", "monthly"]);
    expect(buckets[0]!.pct).toBe(0);
    expect(buckets[0]!.resetInSec).toBe(18000);
    expect(buckets[2]!.pct).toBe(52);
    expect(formatResetIn(18000)).toBe("5 hours 0 minutes");
    expect(formatResetIn(359290)).toBe("4 days 3 hours");
    expect(formatResetIn(591160)).toBe("6 days 20 hours");
  });

  test("returns empty when the page has no meters", async () => {
    const { parseOpenCodeGoHtml } = await import("../src/adapters/opencode-subscription");
    expect(parseOpenCodeGoHtml("<html>nope</html>")).toEqual([]);
  });
});
