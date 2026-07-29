import type { Source } from "../adapters/types";
import {
  fetchSubscriptionUsage,
  type LimitBucket,
} from "../adapters/claude-subscription";
import { CursorAuthError } from "../adapters/cursor";
import {
  fetchCursorPeriodUsage,
  type CursorSpendBucket,
  type CursorPeriodUsage,
} from "../adapters/cursor-spending";
import {
  fetchOpenCodeGoUsage,
  type OpenCodeGoBucket,
} from "../adapters/opencode-subscription";

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
  /** Cursor spending pools from dashboard/spending (Included / Other / On-Demand). */
  cursorBuckets?: CursorSpendBucket[];
  /** OpenCode Go rolling / weekly / monthly meters. */
  openCodeBuckets?: OpenCodeGoBucket[];
  hardLimitUsd?: number | null;
  fetchedAt: number | null;
};

const CACHE_MS = 60_000;
let cursorCache: { at: number; value: SourceSubscription } | null = null;
let openCodeCache: { at: number; value: SourceSubscription } | null = null;

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
  const cfg = loadConfig();
  const [claude, opencode, cursor] = await Promise.all([
    readClaude(force),
    readOpenCode(force),
    readCursor(force),
  ]);
  const sources = [claude, opencode, cursor].map((s) => ({
    ...s,
    plan: planLabel(s.source, cfg.plans[s.source]),
  }));
  return { sources };
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

async function readOpenCode(force: boolean): Promise<SourceSubscription> {
  if (!force && openCodeCache && Date.now() - openCodeCache.at < CACHE_MS) {
    return openCodeCache.value;
  }

  const u = await fetchOpenCodeGoUsage(force);
  const value: SourceSubscription = {
    source: "opencode",
    status: u.status,
    message: u.message,
    plan: u.plan,
    buckets: u.buckets.map((b) => ({
      key: b.key,
      pct: b.pct,
      used: null,
      limit: null,
      resetsAt: Date.now() + b.resetInSec * 1000,
    })),
    openCodeBuckets: u.status === "ok" ? u.buckets : u.buckets.length ? u.buckets : undefined,
    fetchedAt: u.fetchedAt,
  };
  if (u.status === "ok" || u.status === "disabled") {
    openCodeCache = { at: Date.now(), value };
  }
  return value;
}

/**
 * Cursor answered, but with no caps to draw a bar from. Report the request
 * count it did give so the card says something true instead of looking broken.
 * Kept for tests / fallback when only the legacy /api/usage payload is present.
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

  if (!force && cursorCache && Date.now() - cursorCache.at < CACHE_MS) {
    return cursorCache.value;
  }

  try {
    const period: CursorPeriodUsage = await fetchCursorPeriodUsage(cookie, force);
    // Mirror percent buckets into the generic LimitBucket shape so older UI
    // paths still work; the Cursor card prefers cursorBuckets.
    const buckets: LimitBucket[] = period.buckets
      .filter((b) => b.key !== "onDemand")
      .map((b) => ({
        key: b.key,
        pct: b.pct,
        used: b.used,
        limit: b.limit,
        resetsAt: period.billingCycleEnd,
      }));
    const onDemand = period.buckets.find((b) => b.key === "onDemand");
    if (onDemand && onDemand.used != null && onDemand.limit != null) {
      buckets.push({
        key: "onDemand",
        pct: onDemand.pct,
        used: onDemand.used,
        limit: onDemand.limit,
        resetsAt: period.billingCycleEnd,
      });
    }

    const value: SourceSubscription = {
      source: "cursor",
      status: "ok",
      plan: period.plan,
      buckets: usefulBuckets(buckets),
      cursorBuckets: period.buckets,
      hardLimitUsd: period.hardLimitUsd,
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
        : "Cursor spending request failed. The unofficial API may have changed.",
      // Keep the last good reading rather than blanking the card.
      plan: cursorCache?.value.plan ?? null,
      buckets: cursorCache?.value.buckets ?? [],
      cursorBuckets: cursorCache?.value.cursorBuckets,
      hardLimitUsd: cursorCache?.value.hardLimitUsd,
      fetchedAt: cursorCache?.value.fetchedAt ?? null,
    };
  }
}
