import type { Adapter, UsageEvent } from "./types";
import { makeEventId } from "./util";

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
  return parseCursorPayload(await fetchCursorRawUsage(cookie));
}

/**
 * Apex host on purpose: `www.cursor.com` 308-redirects here, and fetch drops the
 * Cookie header across that cross-origin hop, so the request arrives
 * unauthenticated and the API answers 401. Do not add `www.`.
 */
export const CURSOR_USAGE_URL = "https://cursor.com/api/usage";

/** The untouched account payload. Shared with the subscription/quota reader. */
export async function fetchCursorRawUsage(
  cookie: string,
): Promise<Record<string, unknown>> {
  // Undocumented account usage endpoint — shape may change without notice
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

export function parseCursorPayload(body: Record<string, unknown>): UsageEvent[] {
  const events: UsageEvent[] = [];
  // Observed shapes vary: { "gpt-4": { numRequests, numTokens, ... }, ... }
  // or nested under startOfMonth / usage. Ingest whatever token totals we can find.
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
  // Bucket coarse monthly data at the start of the current UTC month
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
