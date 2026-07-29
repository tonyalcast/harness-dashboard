/**
 * Unofficial OpenCode Go subscription reader.
 *
 * There is no public usage API yet. This fetches the workspace Go page and
 * parses the SolidJS SSR hydration blob for rolling / weekly / monthly meters
 * — the same numbers shown at https://opencode.ai/workspace/<id>/go.
 *
 * Disabled unless OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE are set.
 * The cookie is never logged, written to SQLite, or returned by any route.
 */

export type OpenCodeGoBucket = {
  key: "continuous" | "weekly" | "monthly";
  label: string;
  pct: number;
  resetInSec: number;
  status: string;
};

export type OpenCodeGoUsage = {
  status: "disabled" | "ok" | "auth" | "error";
  message?: string;
  plan: string | null;
  buckets: OpenCodeGoBucket[];
  fetchedAt: number | null;
};

const CACHE_MS = 60_000;
let cache: { at: number; value: OpenCodeGoUsage } | null = null;

class OpenCodeAuthError extends Error {}
export { OpenCodeAuthError };

export function openCodeGoConfigured(): boolean {
  return Boolean(
    process.env.OPENCODE_GO_WORKSPACE_ID?.trim() &&
      process.env.OPENCODE_GO_AUTH_COOKIE?.trim(),
  );
}

export function openCodeGoUrl(workspaceId: string): string {
  return `https://opencode.ai/workspace/${workspaceId}/go`;
}

export async function fetchOpenCodeGoUsage(force = false): Promise<OpenCodeGoUsage> {
  const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const cookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();

  if (!workspaceId || !cookie) {
    return {
      status: "disabled",
      message:
        "Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE in .env to read your OpenCode Go quota.",
      plan: null,
      buckets: [],
      fetchedAt: null,
    };
  }

  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.value;
  }

  try {
    const html = await fetchGoHtml(workspaceId, cookie);
    const buckets = parseOpenCodeGoHtml(html);
    if (buckets.length === 0) {
      const value: OpenCodeGoUsage = {
        status: "error",
        message:
          "Connected, but no usage meters were found in the OpenCode Go page. The page shape may have changed.",
        plan: "Go",
        buckets: [],
        fetchedAt: Date.now(),
      };
      cache = { at: Date.now(), value };
      return value;
    }
    const value: OpenCodeGoUsage = {
      status: "ok",
      plan: "Go",
      buckets,
      fetchedAt: Date.now(),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    const auth = err instanceof OpenCodeAuthError;
    return {
      status: auth ? "auth" : "error",
      message: auth
        ? "OpenCode session expired. Refresh OPENCODE_GO_AUTH_COOKIE in `.env`."
        : "OpenCode Go usage request failed. The unofficial page scrape may have changed.",
      plan: cache?.value.plan ?? null,
      buckets: cache?.value.buckets ?? [],
      fetchedAt: cache?.value.fetchedAt ?? null,
    };
  }
}

async function fetchGoHtml(workspaceId: string, cookie: string): Promise<string> {
  const res = await fetch(openCodeGoUrl(workspaceId), {
    headers: {
      Cookie: `auth=${cookie}`,
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "manual",
  });

  if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
    const loc = res.headers.get("location") ?? "";
    if (/sign-?in|login|auth/i.test(loc)) throw new OpenCodeAuthError();
    // Follow one hop with the cookie still attached (fetch would drop it cross-origin).
    const next = new URL(loc, "https://opencode.ai").toString();
    const res2 = await fetch(next, {
      headers: {
        Cookie: `auth=${cookie}`,
        Accept: "text/html",
        "User-Agent": "Mozilla/5.0",
      },
      redirect: "manual",
    });
    if (res2.status === 401 || res2.status === 403) throw new OpenCodeAuthError();
    if (!res2.ok) throw new Error(`status ${res2.status}`);
    const html2 = await res2.text();
    if (looksLikeSignIn(html2)) throw new OpenCodeAuthError();
    return html2;
  }

  if (res.status === 401 || res.status === 403) throw new OpenCodeAuthError();
  if (!res.ok) throw new Error(`status ${res.status}`);
  const html = await res.text();
  if (looksLikeSignIn(html)) throw new OpenCodeAuthError();
  return html;
}

function looksLikeSignIn(html: string): boolean {
  return /sign[\s-]?in|\/auth\/|log[\s-]?in to continue/i.test(html) &&
    !/rollingUsage|weeklyUsage|monthlyUsage|usagePercent/.test(html);
}

/**
 * Parse rolling / weekly / monthly meters from the Go page hydration script.
 * Observed shape:
 *   rollingUsage:$R[n]={status:"ok",resetInSec:18000,usagePercent:0},
 *   weeklyUsage:$R[n]={status:"ok",resetInSec:359290,usagePercent:0},
 *   monthlyUsage:$R[n]={status:"ok",resetInSec:591160,usagePercent:52}
 */
export function parseOpenCodeGoHtml(html: string): OpenCodeGoBucket[] {
  const specs: Array<{
    key: OpenCodeGoBucket["key"];
    label: string;
    field: string;
  }> = [
    { key: "continuous", label: "Continuous usage", field: "rollingUsage" },
    { key: "weekly", label: "Weekly usage", field: "weeklyUsage" },
    { key: "monthly", label: "Monthly usage", field: "monthlyUsage" },
  ];

  const out: OpenCodeGoBucket[] = [];
  for (const spec of specs) {
    const m = html.match(
      new RegExp(
        `${spec.field}\\s*:\\s*\\$R\\[\\d+\\]\\s*=\\s*(\\{[^}]*\\})`,
      ),
    );
    const obj = m?.[1] ? parseLooseObject(m[1]) : null;
    if (!obj) continue;
    const pct = num(obj.usagePercent);
    const resetInSec = num(obj.resetInSec);
    if (pct == null || resetInSec == null) continue;
    out.push({
      key: spec.key,
      label: spec.label,
      pct,
      resetInSec,
      status: typeof obj.status === "string" ? obj.status : "ok",
    });
  }
  return out;
}

/** Format resetInSec like the OpenCode UI: "5 hours 0 minutes", "4 days 3 hours". */
export function formatResetIn(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function parseLooseObject(raw: string): Record<string, unknown> | null {
  // Hydration uses unquoted keys: {status:"ok",resetInSec:18000,usagePercent:0}
  try {
    const quoted = raw.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
    return JSON.parse(quoted) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
