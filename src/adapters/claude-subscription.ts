/**
 * Unofficial claude.ai subscription-usage reader.
 *
 * Disabled unless CLAUDE_SESSION_COOKIE and CLAUDE_ORG_ID are set in .env.
 * This is the same endpoint the Usage screen on claude.ai calls. It is
 * undocumented and will change without notice — treat every field as optional.
 *
 * The cookie is never logged, written to SQLite, or returned by any route.
 */

export type LimitBucket = {
  /** Where in the payload this came from, e.g. "five_hour". */
  key: string;
  /** 0–100 when the payload gave us something percentage-shaped. */
  pct: number | null;
  used: number | null;
  limit: number | null;
  resetsAt: number | null;
};

export type SubscriptionUsage = {
  status: "disabled" | "ok" | "auth" | "error";
  message?: string;
  fetchedAt: number | null;
  plan: string | null;
  buckets: LimitBucket[];
};

export type ClaudeCredentials = { cookie: string; org: string };

const CACHE_MS = 60_000;
/** Keyed per account so several claude.ai seats never share a reading. */
const caches = new Map<string, { at: number; value: SubscriptionUsage }>();

/** The primary account, from .env / Settings. */
export function primaryClaudeCredentials(): ClaudeCredentials | null {
  const cookie = process.env.CLAUDE_SESSION_COOKIE?.trim();
  const org = process.env.CLAUDE_ORG_ID?.trim();
  return cookie && org ? { cookie, org } : null;
}

export function subscriptionConfigured(): boolean {
  return Boolean(
    process.env.CLAUDE_SESSION_COOKIE?.trim() && process.env.CLAUDE_ORG_ID?.trim(),
  );
}

/**
 * Accept whatever the user copied out of DevTools: the bare value, a
 * `sessionKey=…` pair, or the whole Cookie header. Sending the prefix twice
 * (`sessionKey=sessionKey=…`) is rejected by claude.ai as an invalid session.
 */
export function normalizeSessionKey(input: string): string {
  let v = input.trim().replace(/^cookie:\s*/i, "");
  const pair = v.split(";").map((p) => p.trim()).find((p) => /^sessionKey=/i.test(p));
  if (pair) v = pair.slice(pair.indexOf("=") + 1);
  v = v.trim().replace(/^["']|["']$/g, "");
  try {
    v = decodeURIComponent(v);
  } catch {
    // not URL-encoded
  }
  return v.trim();
}

class AuthError extends Error {
  /** claude.ai's `error.details.error_code`, e.g. "account_session_invalid". */
  constructor(readonly code: string | null, message: string | null) {
    super(message ?? "unauthorized");
  }
  /** Only this code really means the cookie is bad; anything else is usually the org ID. */
  get sessionInvalid() {
    // A wrong org (e.g. the Console/API org) comes back as a bare 403
    // "Invalid authorization for organization" with no error_code.
    if (this.code === null) return !/organization/i.test(this.message);
    return this.code === "account_session_invalid";
  }
}

export async function fetchSubscriptionUsage(
  force = false,
  creds: ClaudeCredentials | null = primaryClaudeCredentials(),
  cacheKey = "primary",
): Promise<SubscriptionUsage> {
  if (!creds) {
    return {
      status: "disabled",
      message:
        "Set CLAUDE_SESSION_COOKIE and CLAUDE_ORG_ID in .env to read your subscription usage.",
      fetchedAt: null,
      plan: null,
      buckets: [],
    };
  }

  const key = `${cacheKey}:${creds.org}:${creds.cookie}`;
  const cache = caches.get(key);
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const raw = await requestUsage(creds.cookie, creds.org);
    const value: SubscriptionUsage = {
      status: "ok",
      fetchedAt: Date.now(),
      plan: findPlan(raw),
      buckets: findLimitBuckets(raw),
    };
    caches.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    const auth = err instanceof AuthError;
    const value: SubscriptionUsage = {
      status: auth ? "auth" : "error",
      message: auth
        ? err.sessionInvalid
          ? "claude.ai session expired. Refresh CLAUDE_SESSION_COOKIE in `.env`."
          : `claude.ai rejected the request (${err.code ?? err.message}). Check that the org ID belongs to this session's account.`
        : "Usage request failed. This undocumented endpoint may have changed.",
      // Keep the last good reading rather than blanking the card.
      fetchedAt: cache?.value.fetchedAt ?? null,
      plan: cache?.value.plan ?? null,
      buckets: cache?.value.buckets ?? [],
    };
    return value;
  }
}

/** Raw payload, for adapting the parser when the shape changes. Never cached. */
export async function fetchSubscriptionRaw(): Promise<unknown> {
  const creds = primaryClaudeCredentials();
  if (!creds) return { error: "not configured" };
  return requestUsage(creds.cookie, creds.org);
}

async function requestUsage(cookie: string, org: string): Promise<unknown> {
  const res = await fetch(
    `https://claude.ai/api/organizations/${encodeURIComponent(org)}/usage`,
    {
      headers: {
        Cookie: `sessionKey=${normalizeSessionKey(cookie)}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (res.status === 401 || res.status === 403) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string; details?: { error_code?: string } };
    } | null;
    throw new AuthError(body?.error?.details?.error_code ?? null, body?.error?.message ?? null);
  }
  if (!res.ok) throw new Error(`status ${res.status}`);
  return res.json();
}

const PCT_KEYS = ["utilization", "percent_used", "percentage", "pct", "used_percent"];
const USED_KEYS = ["used", "usage", "consumed", "used_credits", "current", "numRequests"];
const LIMIT_KEYS = ["limit", "total", "max", "quota", "allowed", "maxRequestUsage"];
const RESET_KEYS = ["resets_at", "reset_at", "resetsAt", "resetAt", "expires_at", "next_reset"];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in o) return o[k];
  return undefined;
}

function toEpoch(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seconds vs milliseconds — anything before year 2001 in ms is really seconds.
    return v < 1e11 ? v * 1000 : v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Walk the payload and collect anything that looks like a rate-limit bucket,
 * so a shape change degrades into "fewer buckets" rather than a crash.
 */
export function findLimitBuckets(raw: unknown): LimitBucket[] {
  const out: LimitBucket[] = [];
  const seen = new Set<unknown>();

  function walk(node: unknown, path: string, depth: number) {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, path ? `${path}[${i}]` : `[${i}]`, depth + 1));
      return;
    }

    const o = node as Record<string, unknown>;
    const rawPct = num(pick(o, PCT_KEYS));
    const used = num(pick(o, USED_KEYS));
    const limit = num(pick(o, LIMIT_KEYS));
    const resetsAt = toEpoch(pick(o, RESET_KEYS));

    const isBucket = rawPct != null || resetsAt != null || (used != null && limit != null);
    if (isBucket && path) {
      // Some payloads express utilization as 0–1, others as 0–100.
      let pct = rawPct;
      if (pct != null && pct <= 1 && (used == null || limit == null)) pct = pct * 100;
      if (pct == null && used != null && limit != null && limit > 0) pct = (used / limit) * 100;
      out.push({ key: path, pct, used, limit, resetsAt });
    }

    for (const [k, v] of Object.entries(o)) {
      walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  }

  walk(raw, "", 0);
  return out;
}

function findPlan(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const k of ["plan", "subscription", "tier", "plan_type", "subscription_tier"]) {
    const v = o[k];
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>).name ?? (v as Record<string, unknown>).type;
      if (typeof inner === "string") return inner;
    }
  }
  return null;
}

/** Exposed for tests — the parser is the fragile part, not the fetch. */
export const __parse = { findBuckets: findLimitBuckets, findPlan, toEpoch };
