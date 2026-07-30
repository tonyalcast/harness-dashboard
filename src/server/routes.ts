import type { AppConfig, Filter, FilterPreset, Source } from "../adapters/types";
import {
  aggregate,
  computeWhatIf,
  resolvePresetRange,
  startOfLocalMonth,
} from "../core/aggregate";
import { fetchSubscriptionRaw } from "../adapters/claude-subscription";
import { buildSubscriptionReport } from "../core/subscription";
import { buildExplain } from "../core/explain";
import { getUnpricedModels, loadPricing, lookupPriceDetail } from "../core/pricing";
import { currentWindowState, readReportedClaudeWindow } from "../core/window";
import { loadConfig, planMultiplier, updateConfig } from "../config";
import { refreshHarnessCredentials } from "../load-env";
import {
  loadSecrets,
  saveSecrets,
  secretsSnapshot,
  type HarnessSecrets,
} from "../secrets";
import {
  queryEvents,
  queryAllEvents,
  queryRecords,
  recordTotals,
  distinctModels,
  eventCount,
  lastIngestAt,
  sourceCounts,
  type RecordSort,
} from "../db/query";
import { getMeta } from "../db/ingest";
import { runIngest } from "./ingest-runner";
import { addSseClient, sseResponse } from "./sse";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function parseSources(raw: string | null): Source[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Source => s === "claude-code" || s === "opencode" || s === "cursor");
}

function parseFilter(url: URL, cfg: AppConfig, now: number): Filter {
  const preset = (url.searchParams.get("preset") as FilterPreset) || "today";
  const fromQ = url.searchParams.get("from");
  const toQ = url.searchParams.get("to");
  const custom =
    fromQ && toQ ? { from: Number(fromQ), to: Number(toQ) } : undefined;
  const range = resolvePresetRange(preset, cfg.timezone, now, custom);
  const models = url.searchParams.get("models");
  return {
    range,
    preset,
    sources: parseSources(url.searchParams.get("sources")),
    models: models ? models.split(",").filter(Boolean) : undefined,
  };
}

export function buildSummary(filter: Filter, cfg: AppConfig, now = Date.now()) {
  loadPricing();
  const rows = queryEvents(filter);
  // Weekly/budget need broader data — pull week/month from all matching sources
  const weekFrom = now - 7 * 24 * 60 * 60 * 1000;
  const monthFilter: Filter = {
    ...filter,
    range: { from: 0, to: now },
    preset: "all",
  };
  const allForExtras = queryEvents(monthFilter);
  const summary = aggregate(rows, filter, {
    now,
    timezone: cfg.timezone,
    weeklyBaselineTokens: cfg.weeklyBaselineTokens,
    planMultiplier: planMultiplier(cfg.plans["claude-code"]),
    monthlyBudgetUsd: cfg.monthlyBudgetUsd,
    unpricedModels: getUnpricedModels(),
  });

  // Recompute weekly from last 7d across same sources
  const weekRows = allForExtras.filter((r) => r.ts >= weekFrom && r.ts <= now);
  const weekTokens = weekRows.reduce(
    (s, r) => s + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
    0,
  );
  const baseline =
    cfg.weeklyBaselineTokens > 0
      ? cfg.weeklyBaselineTokens * planMultiplier(cfg.plans["claude-code"])
      : 0;
  summary.weekly = {
    tokens: weekTokens,
    baseline,
    pct: baseline > 0 ? (weekTokens / baseline) * 100 : null,
    estimated: true,
    calibrated: cfg.weeklyBaselineTokens > 0,
  };

  const ms = startOfLocalMonth(now, cfg.timezone);
  const monthSpend = allForExtras
    .filter((r) => r.ts >= ms)
    .reduce((s, r) => s + r.cost_api, 0);
  summary.budget = {
    monthlyBudgetUsd: cfg.monthlyBudgetUsd,
    spentApi: monthSpend,
    pct: cfg.monthlyBudgetUsd > 0 ? (monthSpend / cfg.monthlyBudgetUsd) * 100 : null,
  };

  return summary;
}

export async function handleApi(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/")) return null;

  const cfg = loadConfig();
  const now = Date.now();

  if (url.pathname === "/api/summary" && req.method === "GET") {
    const filter = parseFilter(url, cfg, now);
    return json(buildSummary(filter, cfg, now));
  }

  if (url.pathname === "/api/window" && req.method === "GET") {
    const all = queryAllEvents().filter((r) => r.source === "claude-code" || r.source === "opencode");
    const timestamps = all.map((r) => r.ts);
    const weights = all.map(
      (r) => r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
    );
    const reported = readReportedClaudeWindow();
    return json(currentWindowState(timestamps, weights, now, reported));
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    let health = [];
    try {
      health = JSON.parse(getMeta("last_health") ?? "[]");
    } catch {
      health = [];
    }
    return json({
      ok: true,
      bind: "127.0.0.1",
      events: eventCount(),
      lastIngestAt: lastIngestAt(),
      sources: sourceCounts(),
      adapters: health,
    });
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    return json(cfg);
  }

  if (url.pathname === "/api/config" && req.method === "PUT") {
    const body = (await req.json()) as Partial<AppConfig>;
    const next = updateConfig(body);
    return json(next);
  }

  if (url.pathname === "/api/secrets" && req.method === "GET") {
    return json(secretsSnapshot());
  }

  if (url.pathname === "/api/secrets" && req.method === "PUT") {
    const body = (await req.json()) as HarnessSecrets;
    const stored = loadSecrets();
    const next = saveSecrets({ ...stored, ...body });
    refreshHarnessCredentials();
    return json({ secrets: next, active: secretsSnapshot().active });
  }

  if (url.pathname === "/api/calibrate" && req.method === "POST") {
    const weekFrom = now - 7 * 24 * 60 * 60 * 1000;
    const rows = queryAllEvents().filter((r) => r.ts >= weekFrom && r.ts <= now);
    const total = rows.reduce(
      (s, r) => s + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
      0,
    );
    // Store as baseline for current plan multiplier so raw baseline is total/multiplier
    const mult = planMultiplier(cfg.plans["claude-code"]);
    const baseline = mult > 0 ? Math.round(total / mult) : total;
    const next = updateConfig({ weeklyBaselineTokens: baseline });
    return json({ weeklyBaselineTokens: next.weeklyBaselineTokens, weekTokens: total });
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    const result = await runIngest({ full: true });
    return json(result);
  }

  if (url.pathname === "/api/subscription" && req.method === "GET") {
    const force = url.searchParams.get("force") === "1";
    return json(await buildSubscriptionReport(force));
  }

  // Local-only escape hatch: shows the untouched payload so the parser can be
  // adapted when the undocumented endpoint changes shape.
  if (url.pathname === "/api/subscription/raw" && req.method === "GET") {
    return json(await fetchSubscriptionRaw());
  }

  if (url.pathname === "/api/records" && req.method === "GET") {
    loadPricing();
    const filter = parseFilter(url, cfg, now);
    const q = {
      filter,
      search: url.searchParams.get("q") ?? undefined,
      sort: (url.searchParams.get("sort") as RecordSort) || "ts",
      dir: url.searchParams.get("dir") === "asc" ? ("asc" as const) : ("desc" as const),
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
    };
    const rows = queryRecords(q);
    const priceCache = new Map<string, ReturnType<typeof lookupPriceDetail>>();
    const records = rows.map((r) => {
      if (!priceCache.has(r.model)) priceCache.set(r.model, lookupPriceDetail(r.model));
      const match = priceCache.get(r.model)!;
      const p = match?.price;
      const parts = {
        in: r.in_tokens * (p?.input ?? 0),
        out: r.out_tokens * (p?.output ?? 0),
        cacheWrite: r.cache_write * (p?.cacheWrite ?? 0),
        cacheRead: r.cache_read * (p?.cacheRead ?? 0),
      };
      return {
        id: r.id,
        ts: r.ts,
        source: r.source,
        model: r.model,
        sessionId: r.session_id,
        project: r.project,
        tokens: {
          in: r.in_tokens,
          out: r.out_tokens,
          cacheWrite: r.cache_write,
          cacheRead: r.cache_read,
          total: r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
        },
        priced: match != null,
        matchedKey: match?.matchedKey ?? null,
        costParts: parts,
        // What the current rate table says, vs what was stored at ingest time.
        costApi: parts.in + parts.out + parts.cacheWrite + parts.cacheRead,
        costApiStored: r.cost_api,
        costReported: r.cost_reported,
      };
    });
    return json({
      filter,
      sort: q.sort,
      dir: q.dir,
      limit: q.limit,
      offset: q.offset,
      search: q.search ?? "",
      totals: recordTotals(q),
      models: distinctModels(),
      records,
    });
  }

  if (url.pathname === "/api/explain" && req.method === "GET") {
    const filter = parseFilter(url, cfg, now);
    loadPricing();
    return json(buildExplain(queryEvents(filter), filter, now));
  }

  if (url.pathname === "/api/whatif" && req.method === "GET") {
    const filter = parseFilter(url, cfg, now);
    const model = url.searchParams.get("model") || "claude-sonnet-4-20250514";
    const rows = queryEvents(filter);
    return json({ model, ...computeWhatIf(rows, model) });
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const { stream } = addSseClient(url.search);
    return sseResponse(stream);
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    const filter = parseFilter(url, cfg, now);
    const rows = queryEvents(filter);
    const format = url.searchParams.get("format") || "json";
    if (format === "csv") {
      const header =
        "id,ts,source,model,session_id,project,in_tokens,out_tokens,cache_write,cache_read,cost_reported,cost_api\n";
      const body = rows
        .map((r) =>
          [
            r.id,
            r.ts,
            r.source,
            r.model,
            r.session_id,
            csvEscape(r.project ?? ""),
            r.in_tokens,
            r.out_tokens,
            r.cache_write,
            r.cache_read,
            r.cost_reported ?? "",
            r.cost_api,
          ].join(","),
        )
        .join("\n");
      return new Response(header + body, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=harness-export.csv",
        },
      });
    }
    return new Response(JSON.stringify(rows, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=harness-export.json",
      },
    });
  }

  return json({ error: "Not found" }, 404);
}

function csvEscape(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
