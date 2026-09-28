import type { Source } from "../adapters/types";
import {
  fetchSubscriptionUsage,
  primaryClaudeCredentials,
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
  primaryOpenCodeCredentials,
  type OpenCodeGoBucket,
} from "../adapters/opencode-subscription";
import { loadAccounts, PRIMARY_ACCOUNT_ID, type ExtraAccount } from "../accounts";
import { loadConfig, planLabel } from "../config";
import { pickPrimaryMeter } from "./reset-format";

export type SubscriptionStatus =
  | "ok"
  | "auth"
  | "error"
  | "disabled"
  /** The harness has no subscription pool to report — you pay per API call. */
  | "not-applicable";

export type SourceSubscription = {
  source: Source;
  /** "primary" for the .env / Settings account, otherwise the extra account id. */
  accountId: string;
  /** Custom display name; the UI falls back to the harness name when absent. */
  label?: string;
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
  /** Soonest/primary window reset (epoch ms). */
  nextResetAt: number | null;
  /** Utilization % for the primary window (0–100). */
  primaryPct: number | null;
};

const CACHE_MS = 60_000;
const cursorCaches = new Map<string, { at: number; value: SourceSubscription }>();
const openCodeCaches = new Map<string, { at: number; value: SourceSubscription }>();

const ORDER: Source[] = ["claude-code", "opencode", "cursor"];

/** One subscription seat to read: the primary one or an extra from accounts.json. */
type AccountRef = {
  source: Source;
  accountId: string;
  label?: string;
  primary: boolean;
  extra?: ExtraAccount;
};

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
 * Subscription utilization per account. Each vendor bills differently, so these
 * are independent readings, not one number split several ways. Every harness
 * always reports its primary account first, followed by any extra accounts.
 */
export async function buildSubscriptionReport(
  force = false,
): Promise<{ sources: SourceSubscription[] }> {
  const cfg = loadConfig();
  const accounts = loadAccounts();
  const refs: AccountRef[] = ORDER.flatMap((source) => [
    {
      source,
      accountId: PRIMARY_ACCOUNT_ID,
      label: accounts.primaryLabels[source],
      primary: true,
    },
    ...accounts.extra
      .filter((a) => a.source === source)
      .map((a) => ({
        source,
        accountId: a.id,
        label: a.label,
        primary: false,
        extra: a,
      })),
  ]);

  const readings = await Promise.all(refs.map((ref) => readAccount(ref, force)));
  const sources = readings.map((s, i) => {
    const ref = refs[i]!;
    const enriched = withPrimaryMeter(s);
    const configuredPlan = ref.primary ? cfg.plans[ref.source] : ref.extra?.plan;
    return {
      ...enriched,
      accountId: ref.accountId,
      label: ref.label,
      plan: configuredPlan ? planLabel(ref.source, configuredPlan) : enriched.plan,
    };
  });
  return { sources };
}

function readAccount(ref: AccountRef, force: boolean): Promise<SourceSubscription> {
  if (ref.source === "claude-code") return readClaude(ref, force);
  if (ref.source === "opencode") return readOpenCode(ref, force);
  return readCursor(ref, force);
}

/** Where to fix a credential: .env for the primary, Settings for extras. */
function credentialHint(ref: AccountRef, key: string): string {
  return ref.primary ? `${key} in \`.env\`` : "the cookie in Settings → Additional accounts";
}

function withPrimaryMeter(s: SourceSubscription): SourceSubscription {
  const candidates = [
    ...s.buckets.map((b) => ({
      key: b.key,
      pct: b.pct,
      resetsAt: b.resetsAt,
    })),
    ...(s.openCodeBuckets ?? []).map((b) => ({
      key: b.key,
      pct: b.pct,
      resetsAt: Date.now() + b.resetInSec * 1000,
    })),
    ...(s.cursorBuckets ?? []).map((b) => ({
      key: b.key,
      pct: b.pct,
      resetsAt: s.buckets.find((x) => x.key === b.key)?.resetsAt ?? null,
    })),
  ];
  const { nextResetAt, primaryPct } = pickPrimaryMeter(candidates);
  return { ...s, nextResetAt, primaryPct };
}

async function readClaude(ref: AccountRef, force: boolean): Promise<SourceSubscription> {
  const creds = ref.extra
    ? ref.extra.cookie && ref.extra.orgId
      ? { cookie: ref.extra.cookie, org: ref.extra.orgId }
      : null
    : primaryClaudeCredentials();
  const u = await fetchSubscriptionUsage(force, creds, ref.accountId);
  return {
    source: "claude-code",
    accountId: ref.accountId,
    status: u.status,
    message: ref.extra
      ? u.status === "disabled"
        ? "Add a session cookie and org ID in Settings to read this account."
        : u.status === "auth" && u.message?.includes("session expired")
          ? `claude.ai session expired. Refresh ${credentialHint(ref, "CLAUDE_SESSION_COOKIE")}.`
          : u.message
      : u.message,
    plan: u.plan,
    buckets: usefulBuckets(u.buckets),
    fetchedAt: u.fetchedAt,
    nextResetAt: null,
    primaryPct: null,
  };
}

async function readOpenCode(ref: AccountRef, force: boolean): Promise<SourceSubscription> {
  const creds = ref.extra
    ? ref.extra.cookie && ref.extra.workspaceId
      ? { cookie: ref.extra.cookie, workspaceId: ref.extra.workspaceId }
      : null
    : primaryOpenCodeCredentials();
  const cacheKey = `${ref.accountId}:${creds?.workspaceId ?? ""}:${creds?.cookie ?? ""}`;
  const openCodeCache = openCodeCaches.get(cacheKey);
  if (!force && openCodeCache && Date.now() - openCodeCache.at < CACHE_MS) {
    return openCodeCache.value;
  }

  const u = await fetchOpenCodeGoUsage(force, creds, ref.accountId);
  const value: SourceSubscription = {
    source: "opencode",
    accountId: ref.accountId,
    status: u.status,
    message: ref.extra
      ? u.status === "disabled"
        ? "Add a workspace ID and auth cookie in Settings to read this account."
        : u.status === "auth"
          ? `OpenCode session expired. Refresh ${credentialHint(ref, "OPENCODE_GO_AUTH_COOKIE")}.`
          : u.message
      : u.message,
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
    nextResetAt: null,
    primaryPct: null,
  };
  if (u.status === "ok" || u.status === "disabled") {
    openCodeCaches.set(cacheKey, { at: Date.now(), value });
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

async function readCursor(ref: AccountRef, force: boolean): Promise<SourceSubscription> {
  const cookie = ref.extra ? ref.extra.cookie : process.env.CURSOR_SESSION_COOKIE?.trim();
  if (!cookie) {
    return {
      source: "cursor",
      accountId: ref.accountId,
      status: "disabled",
      message: ref.extra
        ? "Add a session cookie in Settings to read this account."
        : "Set CURSOR_SESSION_COOKIE in .env to read your Cursor quota.",
      plan: null,
      buckets: [],
      fetchedAt: null,
      nextResetAt: null,
      primaryPct: null,
    };
  }

  const cacheKey = `${ref.accountId}:${cookie}`;
  const cursorCache = cursorCaches.get(cacheKey);
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
      accountId: ref.accountId,
      status: "ok",
      plan: period.plan,
      buckets: usefulBuckets(buckets),
      cursorBuckets: period.buckets,
      hardLimitUsd: period.hardLimitUsd,
      fetchedAt: Date.now(),
      nextResetAt: null,
      primaryPct: null,
    };
    cursorCaches.set(cacheKey, { at: Date.now(), value });
    return value;
  } catch (err) {
    const auth = err instanceof CursorAuthError;
    return {
      source: "cursor",
      accountId: ref.accountId,
      status: auth ? "auth" : "error",
      message: auth
        ? `Cursor session expired. Refresh ${credentialHint(ref, "CURSOR_SESSION_COOKIE")}.`
        : "Cursor spending request failed. The unofficial API may have changed.",
      // Keep the last good reading rather than blanking the card.
      plan: cursorCache?.value.plan ?? null,
      buckets: cursorCache?.value.buckets ?? [],
      cursorBuckets: cursorCache?.value.cursorBuckets,
      hardLimitUsd: cursorCache?.value.hardLimitUsd,
      fetchedAt: cursorCache?.value.fetchedAt ?? null,
      nextResetAt: cursorCache?.value.nextResetAt ?? null,
      primaryPct: cursorCache?.value.primaryPct ?? null,
    };
  }
}
