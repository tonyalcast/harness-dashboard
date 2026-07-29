import type { Adapter, UsageEvent } from "./types";
import { makeEventId } from "./util";
import {
  fetchAllCursorUsageEventRows,
  fetchCursorPeriodUsage,
} from "./cursor-spending";

export type CursorParseStats = {
  status: "disabled" | "ok" | "error";
  message?: string;
  events: number;
};

let lastStats: CursorParseStats = { status: "disabled", events: 0 };
let cache: { at: number; events: UsageEvent[] } | null = null;
const CACHE_MS = 60_000;

export function getCursorParseStats(): CursorParseStats {
  return lastStats;
}

/**
 * Unofficial Cursor usage adapter. Disabled unless CURSOR_SESSION_COOKIE is set.
 * The cookie value is never logged, stored, or returned.
 *
 * Ingests row-level usage from dashboard/spending (filtered usage events). The
 * legacy `/api/usage` endpoint is empty on modern Pro plans.
 */
export function createCursorAdapter(): Adapter {
  return {
    source: "cursor",

    async isAvailable() {
      return Boolean(process.env.CURSOR_SESSION_COOKIE?.trim());
    },

    async read(since?: number) {
      const cookie = process.env.CURSOR_SESSION_COOKIE?.trim();
      if (!cookie) {
        lastStats = { status: "disabled", events: 0 };
        return [];
      }

      if (cache && Date.now() - cache.at < CACHE_MS) {
        return since !== undefined ? cache.events.filter((e) => e.ts >= since) : cache.events;
      }

      try {
        const events = await fetchCursorUsage(cookie);
        cache = { at: Date.now(), events };
        lastStats = { status: "ok", events: events.length };
        return since !== undefined ? events.filter((e) => e.ts >= since) : events;
      } catch (err) {
        const message =
          err instanceof CursorAuthError
            ? "Cursor session expired. Refresh the cookie in `.env`."
            : "Cursor usage request failed. The unofficial API may have changed.";
        lastStats = { status: "error", message, events: cache?.events.length ?? 0 };
        // Keep last good data
        return cache?.events ?? [];
      }
    },

    watchPaths() {
      return [];
    },
  };
}

class CursorAuthError extends Error {}

async function fetchCursorUsage(cookie: string): Promise<UsageEvent[]> {
  const period = await fetchCursorPeriodUsage(cookie);
  const from =
    period.billingCycleStart ??
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1);
  const to = Date.now();
  const rows = await fetchAllCursorUsageEventRows(cookie, from, to);
  return parseCursorUsageEventRows(rows);
}

/**
 * Apex host on purpose: `www.cursor.com` 308-redirects here, and fetch drops the
 * Cookie header across that cross-origin hop, so the request arrives
 * unauthenticated and the API answers 401. Do not add `www.`.
 */
export const CURSOR_USAGE_URL = "https://cursor.com/api/usage";

/**
 * Legacy monthly request/token totals from `/api/usage`. Kept for subscription
 * debugging / older plans; ingest no longer relies on this endpoint.
 */
export async function fetchCursorRawUsage(
  cookie: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(CURSOR_USAGE_URL, {
    headers: {
      Cookie: `WorkosCursorSessionToken=${cookie}`,
      Accept: "application/json",
    },
  });

  if (res.status === 401 || res.status === 403) throw new CursorAuthError();
  if (!res.ok) throw new Error(`status ${res.status}`);

  return (await res.json()) as Record<string, unknown>;
}

export { CursorAuthError };

/** Convert spending `usageEventsDisplay` rows into ingest events. */
export function parseCursorUsageEventRows(
  rows: Record<string, unknown>[],
): UsageEvent[] {
  const events: UsageEvent[] = [];

  for (const row of rows) {
    const ts = toEpoch(row.timestamp);
    if (ts == null) continue;
    const model = typeof row.model === "string" && row.model.trim() ? row.model.trim() : "unknown";
    const tokenUsage =
      row.tokenUsage && typeof row.tokenUsage === "object"
        ? (row.tokenUsage as Record<string, unknown>)
        : {};
    const inTok = num(tokenUsage.inputTokens);
    const outTok = num(tokenUsage.outputTokens);
    const cacheWrite = num(tokenUsage.cacheWriteTokens);
    const cacheRead = num(tokenUsage.cacheReadTokens);
    if (inTok + outTok + cacheWrite + cacheRead <= 0) continue;

    const conversationId =
      typeof row.conversationId === "string" && row.conversationId.trim()
        ? row.conversationId.trim()
        : "cursor-account";
    const costCents = numOrNull(tokenUsage.totalCents) ?? numOrNull(row.chargedCents);

    events.push({
      id: makeEventId("cursor", conversationId, model, String(ts)),
      ts,
      source: "cursor",
      model,
      sessionId: conversationId,
      tokens: { in: inTok, out: outTok, cacheWrite, cacheRead },
      costReported: costCents != null ? costCents / 100 : undefined,
    });
  }

  return events;
}

/** Legacy coarse `/api/usage` parser — still covered by tests. */
export function parseCursorPayload(body: Record<string, unknown>): UsageEvent[] {
  const events: UsageEvent[] = [];
  const startMs = parseStart(body);

  for (const [key, val] of Object.entries(body)) {
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const row = val as Record<string, unknown>;
    const tokens =
      num(row.numTokens) ||
      num(row.tokens) ||
      num(row.totalTokens) ||
      num(row.inputTokens) + num(row.outputTokens);
    const requests = num(row.numRequests) || num(row.requests);
    if (tokens <= 0 && requests <= 0) continue;

    const inTok = num(row.inputTokens) || Math.floor(tokens * 0.7);
    const outTok = num(row.outputTokens) || tokens - inTok;

    events.push({
      id: makeEventId("cursor", "cursor-account", key, String(startMs)),
      ts: startMs,
      source: "cursor",
      model: key,
      sessionId: "cursor-account",
      tokens: { in: inTok, out: Math.max(0, outTok), cacheWrite: 0, cacheRead: 0 },
      limited: true,
    });
  }

  return events;
}

function parseStart(body: Record<string, unknown>): number {
  const raw = body.startOfMonth ?? body.billingCycleStart ?? body.startDate;
  if (typeof raw === "string") {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
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
