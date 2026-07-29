import { createClaudeAdapter, getClaudeParseStats } from "../adapters/claude-code";
import { createCursorAdapter, getCursorParseStats } from "../adapters/cursor";
import { createOpenCodeAdapter, getOpenCodeParseStats } from "../adapters/opencode";
import type { Adapter, AdapterStatus, AppConfig, Source } from "../adapters/types";
import { loadConfig } from "../config";
import { getIngestOffset, insertEvents, setIngestOffset, setMeta } from "../db/ingest";
import { loadPricing } from "../core/pricing";

export type AdapterHealth = {
  source: Source;
  status: AdapterStatus;
  message?: string;
  events?: number;
  skipped?: number;
  layout?: string;
};

let adapters: Adapter[] = [];

export function buildAdapters(cfg: AppConfig = loadConfig()): Adapter[] {
  const list: Adapter[] = [];

  if (cfg.adapters["claude-code"].enabled) {
    list.push(
      createClaudeAdapter({
        path: cfg.adapters["claude-code"].path,
        getOffset: getIngestOffset,
        setOffset: setIngestOffset,
      }),
    );
  }

  if (cfg.adapters.opencode.enabled) {
    list.push(createOpenCodeAdapter({ path: cfg.adapters.opencode.path }));
  }

  // Cursor activates only when cookie present (and config allows)
  if (cfg.adapters.cursor.enabled || process.env.CURSOR_SESSION_COOKIE?.trim()) {
    list.push(createCursorAdapter());
  }

  adapters = list;
  return list;
}

export function getAdapters(): Adapter[] {
  return adapters.length ? adapters : buildAdapters();
}

export async function runIngest(opts?: { full?: boolean }): Promise<{
  inserted: number;
  health: AdapterHealth[];
}> {
  loadPricing();
  const cfg = loadConfig();
  const list = buildAdapters(cfg);
  let inserted = 0;
  const health: AdapterHealth[] = [];

  for (const source of ["claude-code", "opencode", "cursor"] as Source[]) {
    const enabled =
      source === "cursor"
        ? Boolean(process.env.CURSOR_SESSION_COOKIE?.trim()) || cfg.adapters.cursor.enabled
        : cfg.adapters[source].enabled;

    if (!enabled && source === "cursor") {
      health.push({ source, status: "disabled", message: "Add CURSOR_SESSION_COOKIE to .env to enable." });
      continue;
    }
    if (!enabled) {
      health.push({ source, status: "disabled" });
      continue;
    }

    const adapter = list.find((a) => a.source === source);
    if (!adapter) {
      health.push({ source, status: "unavailable" });
      continue;
    }

    try {
      const available = await adapter.isAvailable();
      if (!available) {
        health.push({
          source,
          status: "unavailable",
          message:
            source === "cursor"
              ? "No Cursor session cookie configured."
              : "Data directory not found.",
        });
        continue;
      }
      const events = await adapter.read(opts?.full ? undefined : undefined);
      const n = insertEvents(events);
      inserted += n;

      if (source === "claude-code") {
        const s = getClaudeParseStats();
        health.push({
          source,
          status: "ok",
          events: s.events,
          skipped: s.skipped,
        });
      } else if (source === "opencode") {
        const s = getOpenCodeParseStats();
        health.push({
          source,
          status: "ok",
          events: s.events,
          skipped: s.skipped,
          layout: s.layout,
        });
      } else {
        const s = getCursorParseStats();
        health.push({
          source,
          status: s.status === "error" ? "error" : "ok",
          message: s.message,
          events: s.events,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Adapter failed";
      // Never include env/cookie material in logs
      console.error(`[ingest] ${source} error:`, sanitize(message));
      health.push({ source, status: "error", message: sanitize(message) });
    }
  }

  setMeta("last_ingest_at", String(Date.now()));
  setMeta("last_health", JSON.stringify(health));
  return { inserted, health };
}

function sanitize(msg: string): string {
  const cookie = process.env.CURSOR_SESSION_COOKIE;
  if (cookie && cookie.length > 8) return msg.split(cookie).join("[redacted]");
  return msg;
}
