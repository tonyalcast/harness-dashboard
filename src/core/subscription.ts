import type { Source } from "../adapters/types";
import {
  fetchSubscriptionUsage,
  findLimitBuckets,
  type LimitBucket,
} from "../adapters/claude-subscription";
import { CursorAuthError, fetchCursorRawUsage } from "../adapters/cursor";

export type SubscriptionStatus =
  | "ok"
  | "auth"
  | "error"
  | "disabled"
  /** The harness has no subscription pool to report — you pay per API call. */
  | "not-applicable";

export type SourceSubscription = {
  source: Source;
  status: SubscriptionStatus;
  message?: string;
  plan: string | null;
  buckets: LimitBucket[];
  fetchedAt: number | null;
};

const CURSOR_CACHE_MS = 60_000;
let cursorCache: { at: number; value: SourceSubscription } | null = null;

/**
 * The parser is deliberately permissive, so the same limit often surfaces twice:
 * once as a summary node carrying the percentage, and again as a nested entry
 * carrying only a reset time. A bucket with no percentage and no used/limit pair
 * tells the user nothing, so drop it rather than render an empty bar.
 */
export function usefulBuckets(buckets: LimitBucket[]): LimitBucket[] {
  return buckets.filter((b) => b.pct != null || (b.used != null && b.limit != null));
}

/**
 * Subscription utilization per harness. Each vendor bills differently, so this
 * is three independent readings, not one number split three ways.
 */
export async function buildSubscriptionReport(
  force = false,
): Promise<{ sources: SourceSubscription[] }> {
  const [claude, cursor] = await Promise.all([
    readClaude(force),
    readCursor(force),
  ]);
  return { sources: [claude, openCodeSubscription(), cursor] };
}

async function readClaude(force: boolean): Promise<SourceSubscription> {
  const u = await fetchSubscriptionUsage(force);
  return {
    source: "claude-code",
    status: u.status,
    message: u.message,
    plan: u.plan,
    buckets: usefulBuckets(u.buckets),
    fetchedAt: u.fetchedAt,
  };
}

/**
 * OpenCode runs on your own provider keys, so there is no subscription pool to
 * draw down — the API-equivalent cost on the dashboard *is* the real bill.
 */
function openCodeSubscription(): SourceSubscription {
  return {
    source: "opencode",
    status: "not-applicable",
    message:
      "OpenCode runs on your own API keys, so there is no subscription quota. Its API-equivalent cost is what you actually pay.",
    plan: null,
    buckets: [],
    fetchedAt: null,
  };
}

/**
 * Cursor answered, but with no caps to draw a bar from. Report the request
 * count it did give so the card says something true instead of looking broken.
 */
export function describeCursorNoQuota(raw: Record<string, unknown>): string {
  let requests = 0;
  for (const v of Object.values(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const n = (v as Record<string, unknown>).numRequests;
      if (typeof n === "number" && Number.isFinite(n)) requests += n;
    }
  }
  const since = typeof raw.startOfMonth === "string" ? Date.parse(raw.startOfMonth) : NaN;
  const sinceText = Number.isFinite(since)
    ? ` since ${new Date(since).toLocaleDateString()}`
    : "";
  return `Connected. Cursor reports ${requests.toLocaleString("en-US")} request${
    requests === 1 ? "" : "s"
  }${sinceText} and no request cap on this plan, so there is no quota bar to show.`;
}

async function readCursor(force: boolean): Promise<SourceSubscription> {
  const cookie = process.env.CURSOR_SESSION_COOKIE?.trim();
  if (!cookie) {
    return {
      source: "cursor",
      status: "disabled",
      message: "Set CURSOR_SESSION_COOKIE in .env to read your Cursor quota.",
      plan: null,
      buckets: [],
      fetchedAt: null,
    };
  }

  if (!force && cursorCache && Date.now() - cursorCache.at < CURSOR_CACHE_MS) {
    return cursorCache.value;
  }

  try {
    const raw = await fetchCursorRawUsage(cookie);
    // Cursor reports per-model request counts against maxRequestUsage.
    const buckets = usefulBuckets(findLimitBuckets(raw));
    const value: SourceSubscription = {
      source: "cursor",
      status: "ok",
      plan: typeof raw.plan === "string" ? raw.plan : null,
      buckets,
      // An authenticated account with no caps reports nulls, which is not a
      // parse failure — say what the payload actually contained.
      message: buckets.length === 0 ? describeCursorNoQuota(raw) : undefined,
      fetchedAt: Date.now(),
    };
    cursorCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    const auth = err instanceof CursorAuthError;
    return {
      source: "cursor",
      status: auth ? "auth" : "error",
      message: auth
        ? "Cursor session expired. Refresh CURSOR_SESSION_COOKIE in `.env`."
        : "Cursor quota request failed. The unofficial API may have changed.",
      // Keep the last good reading rather than blanking the card.
      plan: cursorCache?.value.plan ?? null,
      buckets: cursorCache?.value.buckets ?? [],
      fetchedAt: cursorCache?.value.fetchedAt ?? null,
    };
  }
}
