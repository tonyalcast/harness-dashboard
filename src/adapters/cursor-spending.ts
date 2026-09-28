/**
 * Unofficial Cursor spending reader — the same endpoints behind
 * https://cursor.com/dashboard/spending.
 *
 * Disabled unless CURSOR_SESSION_COOKIE is set. Cookie is never logged,
 * written to SQLite, or returned by any route. Undocumented; shapes may change.
 */

import { CursorAuthError } from "./cursor";

export type CursorSpendBucket = {
  key: "included" | "other" | "onDemand";
  label: string;
  subtitle?: string;
  hint?: string;
  /** 0–100 when known. */
  pct: number | null;
  used: number | null;
  limit: number | null;
  unit: "percent" | "usd";
};

export type CursorUsageRow = {
  ts: number;
  type: string;
  model: string;
  tokens: number;
  /** "Included" or a dollar string like "$0.12". */
  costLabel: string;
  costCents: number | null;
};

export type CursorEventPreset = "1d" | "7d" | "30d" | "mtd" | "last-month";

export type CursorPeriodUsage = {
  plan: string | null;
  buckets: CursorSpendBucket[];
  hardLimitUsd: number | null;
  billingCycleStart: number | null;
  billingCycleEnd: number | null;
  raw: Record<string, unknown>;
};

export type CursorEventsPage = {
  total: number;
  range: { from: number; to: number; preset: CursorEventPreset };
  events: CursorUsageRow[];
};

/** Apex host on purpose — www 308-redirects and fetch drops Cookie. */
export const CURSOR_PERIOD_URL =
  "https://cursor.com/api/dashboard/get-current-period-usage";
export const CURSOR_HARD_LIMIT_URL =
  "https://cursor.com/api/dashboard/get-hard-limit";
export const CURSOR_EVENTS_URL =
  "https://cursor.com/api/dashboard/get-filtered-usage-events";
export const CURSOR_STRIPE_URL = "https://cursor.com/api/auth/stripe";

const CACHE_MS = 60_000;
/** Keyed by session token so several Cursor accounts never share a reading. */
const periodCaches = new Map<string, { at: number; value: CursorPeriodUsage }>();

function cookieHeaders(cookie: string): HeadersInit {
  return {
    Cookie: `WorkosCursorSessionToken=${cookie}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Origin: "https://cursor.com",
  };
}

async function postJson(
  url: string,
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: cookieHeaders(cookie),
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) throw new CursorAuthError();
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

async function getJson(url: string, cookie: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Cookie: `WorkosCursorSessionToken=${cookie}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) throw new CursorAuthError();
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

export async function fetchCursorPeriodUsage(
  cookie: string,
  force = false,
): Promise<CursorPeriodUsage> {
  const periodCache = periodCaches.get(cookie);
  if (!force && periodCache && Date.now() - periodCache.at < CACHE_MS) {
    return periodCache.value;
  }

  const [periodRaw, hardRaw, stripeRaw] = await Promise.all([
    postJson(CURSOR_PERIOD_URL, cookie, {}),
    postJson(CURSOR_HARD_LIMIT_URL, cookie, {}).catch(() => null),
    getJson(CURSOR_STRIPE_URL, cookie).catch(() => null),
  ]);

  const value = parseCursorPeriod(
    periodRaw,
    hardRaw,
    stripeRaw,
  );
  periodCaches.set(cookie, { at: Date.now(), value });
  return value;
}

export async function fetchCursorUsageEvents(
  cookie: string,
  preset: CursorEventPreset = "1d",
  pageSize = 100,
): Promise<CursorEventsPage> {
  const range = resolveEventRange(preset);
  const raw = await postJson(CURSOR_EVENTS_URL, cookie, {
    startDate: String(range.from),
    endDate: String(range.to),
    page: 1,
    pageSize,
  });
  return parseCursorEvents(raw, range, preset);
}

/**
 * Paginate spending usage events for a date range. Used by the Cursor ingest
 * adapter so the dashboard chart gets real per-request rows (the legacy
 * `/api/usage` endpoint is empty on modern Pro plans).
 */
export async function fetchAllCursorUsageEventRows(
  cookie: string,
  fromMs: number,
  toMs: number,
  pageSize = 200,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let page = 1;
  let total = Infinity;

  while (out.length < total && page <= 50) {
    const raw = await postJson(CURSOR_EVENTS_URL, cookie, {
      startDate: String(fromMs),
      endDate: String(toMs),
      page,
      pageSize,
    });
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const list = Array.isArray(body.usageEventsDisplay)
      ? (body.usageEventsDisplay as unknown[])
      : [];
    total =
      typeof body.totalUsageEventsCount === "number"
        ? body.totalUsageEventsCount
        : list.length;
    for (const item of list) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        out.push(item as Record<string, unknown>);
      }
    }
    if (list.length === 0 || list.length < pageSize) break;
    page += 1;
  }

  return out;
}

export function parseCursorPeriod(
  periodRaw: unknown,
  hardRaw: unknown,
  stripeRaw: unknown,
): CursorPeriodUsage {
  const period =
    periodRaw && typeof periodRaw === "object" && !Array.isArray(periodRaw)
      ? (periodRaw as Record<string, unknown>)
      : {};
  const planUsage =
    period.planUsage && typeof period.planUsage === "object"
      ? (period.planUsage as Record<string, unknown>)
      : {};
  const spendLimit =
    period.spendLimitUsage && typeof period.spendLimitUsage === "object"
      ? (period.spendLimitUsage as Record<string, unknown>)
      : {};

  const autoPct = num(planUsage.autoPercentUsed);
  const apiPct = num(planUsage.apiPercentUsed);

  const individualLimitCents = numOrNull(spendLimit.individualLimit);
  const individualRemainingCents = numOrNull(spendLimit.individualRemaining);
  const hard =
    hardRaw && typeof hardRaw === "object"
      ? numOrNull((hardRaw as Record<string, unknown>).hardLimit)
      : null;

  let onDemandUsed: number | null = null;
  let onDemandLimit: number | null = null;
  let onDemandPct: number | null = null;

  if (individualLimitCents != null && individualRemainingCents != null) {
    onDemandLimit = individualLimitCents / 100;
    onDemandUsed = Math.max(0, (individualLimitCents - individualRemainingCents) / 100);
    onDemandPct =
      onDemandLimit > 0 ? Math.min(100, (onDemandUsed / onDemandLimit) * 100) : null;
  } else if (hard != null && hard >= 0) {
    onDemandLimit = hard;
    onDemandUsed = 0;
    onDemandPct = 0;
  }

  // Prefer the explicit hard-limit dollars when present (dashboard "Fixed 16").
  if (hard != null && hard >= 0 && onDemandLimit == null) {
    onDemandLimit = hard;
  }

  const buckets: CursorSpendBucket[] = [
    {
      key: "included",
      label: "Included in Pro",
      subtitle: "Cursor Models · Includes Cursor Grok 4.5 and Composer 2.5",
      hint:
        "Additional usage beyond limits consumes Other Models quota or on-demand spend.",
      pct: autoPct,
      used: null,
      limit: null,
      unit: "percent",
    },
    {
      key: "other",
      label: "Other Models",
      hint:
        "Additional usage beyond limits consumes on-demand spend. Your plan includes at least $20 of API usage.",
      pct: apiPct,
      used: null,
      limit: null,
      unit: "percent",
    },
    {
      key: "onDemand",
      label: "On-Demand",
      subtitle: "On-Demand Usage",
      hint: "Usage past your limit is billed later as on-demand.",
      pct: onDemandPct,
      used: onDemandUsed,
      limit: onDemandLimit,
      unit: "usd",
    },
  ];

  const stripe =
    stripeRaw && typeof stripeRaw === "object"
      ? (stripeRaw as Record<string, unknown>)
      : {};
  const membership =
    str(stripe.membershipType) ??
    str(stripe.individualMembershipType) ??
    null;

  return {
    plan: membership ? titleCase(membership) : null,
    buckets,
    hardLimitUsd: hard,
    billingCycleStart: toEpoch(period.billingCycleStart),
    billingCycleEnd: toEpoch(period.billingCycleEnd),
    raw: period,
  };
}

export function parseCursorEvents(
  raw: unknown,
  range: { from: number; to: number },
  preset: CursorEventPreset,
): CursorEventsPage {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const list = Array.isArray(body.usageEventsDisplay)
    ? body.usageEventsDisplay
    : [];
  const events: CursorUsageRow[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const ts = toEpoch(row.timestamp);
    if (ts == null) continue;
    const tokenUsage =
      row.tokenUsage && typeof row.tokenUsage === "object"
        ? (row.tokenUsage as Record<string, unknown>)
        : {};
    const tokens =
      num(tokenUsage.inputTokens) +
      num(tokenUsage.outputTokens) +
      num(tokenUsage.cacheWriteTokens) +
      num(tokenUsage.cacheReadTokens);
    const costCents = numOrNull(tokenUsage.totalCents) ?? numOrNull(row.chargedCents);
    const kind = str(row.kind) ?? "";
    const included = kind.includes("INCLUDED");
    const usageBased = str(row.usageBasedCosts);
    let costLabel = "Included";
    if (!included) {
      if (usageBased && usageBased !== "-") costLabel = usageBased.startsWith("$")
        ? usageBased
        : `$${usageBased}`;
      else if (costCents != null) costLabel = formatUsd(costCents / 100);
      else costLabel = "On-Demand";
    }

    events.push({
      ts,
      type: prettyKind(kind),
      model: str(row.model) ?? "unknown",
      tokens,
      costLabel,
      costCents: included ? null : costCents,
    });
  }

  events.sort((a, b) => b.ts - a.ts);

  return {
    total: num(body.totalUsageEventsCount) || events.length,
    range: { from: range.from, to: range.to, preset },
    events,
  };
}

export function resolveEventRange(
  preset: CursorEventPreset,
  now = Date.now(),
): { from: number; to: number } {
  const end = endOfUtcDay(now);
  switch (preset) {
    case "1d":
      return { from: startOfUtcDay(now), to: end };
    case "7d":
      return { from: startOfUtcDay(now - 6 * 86_400_000), to: end };
    case "30d":
      return { from: startOfUtcDay(now - 29 * 86_400_000), to: end };
    case "mtd": {
      const d = new Date(now);
      return {
        from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
        to: end,
      };
    }
    case "last-month": {
      const d = new Date(now);
      const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
      const to = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 1;
      return { from, to };
    }
  }
}

export function isCursorEventPreset(v: string): v is CursorEventPreset {
  return v === "1d" || v === "7d" || v === "30d" || v === "mtd" || v === "last-month";
}

function prettyKind(kind: string): string {
  if (kind.includes("INCLUDED")) return "Included";
  if (kind.includes("USAGE_BASED") || kind.includes("ON_DEMAND")) return "On-Demand";
  if (!kind) return "Usage";
  return kind
    .replace(/^USAGE_EVENT_KIND_/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function endOfUtcDay(ms: number): number {
  return startOfUtcDay(ms) + 86_400_000 - 1;
}

function toEpoch(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v < 1e12 ? Math.round(v * 1000) : v;
  }
  if (typeof v === "string" && v.trim()) {
    if (/^\d+$/.test(v.trim())) {
      const n = Number(v);
      return n < 1e12 ? Math.round(n * 1000) : n;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Test helpers. */
export const __parse = {
  toEpoch,
  prettyKind,
  resolveEventRange,
};
