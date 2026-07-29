import type { AppConfig, Filter, FilterPreset, Source } from "../adapters/types";
import {
  aggregate,
  computeWhatIf,
  resolvePresetRange,
  startOfLocalMonth,
} from "../core/aggregate";
import { getUnpricedModels, loadPricing } from "../core/pricing";
import { currentWindowState, readReportedClaudeWindow } from "../core/window";
import { loadConfig, planMultiplier, updateConfig } from "../config";
import { queryEvents, queryAllEvents, eventCount, lastIngestAt, sourceCounts } from "../db/query";
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
    planMultiplier: planMultiplier(cfg.plan),
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
    cfg.weeklyBaselineTokens > 0 ? cfg.weeklyBaselineTokens * planMultiplier(cfg.plan) : 0;
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
    // Never accept or echo cookie material through config
    const next = updateConfig(body);
    return json(next);
  }

  if (url.pathname === "/api/calibrate" && req.method === "POST") {
    const weekFrom = now - 7 * 24 * 60 * 60 * 1000;
    const rows = queryAllEvents().filter((r) => r.ts >= weekFrom && r.ts <= now);
    const total = rows.reduce(
      (s, r) => s + r.in_tokens + r.out_tokens + r.cache_write + r.cache_read,
      0,
    );
    // Store as baseline for current plan multiplier so raw baseline is total/multiplier
    const mult = planMultiplier(cfg.plan);
    const baseline = mult > 0 ? Math.round(total / mult) : total;
    const next = updateConfig({ weeklyBaselineTokens: baseline });
    return json({ weeklyBaselineTokens: next.weeklyBaselineTokens, weekTokens: total });
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    const result = await runIngest({ full: true });
    return json(result);
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
