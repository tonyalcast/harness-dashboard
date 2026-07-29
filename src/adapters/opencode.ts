import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { Adapter, UsageEvent } from "./types";
import { home, makeEventId } from "./util";

export type OpenCodeParseStats = { files: number; skipped: number; events: number; layout: string };

let lastStats: OpenCodeParseStats = { files: 0, skipped: 0, events: 0, layout: "none" };

export function getOpenCodeParseStats(): OpenCodeParseStats {
  return lastStats;
}

export function openCodeDataDir(override?: string | null): string {
  return override || process.env.OPENCODE_DATA_DIR || home(".local", "share", "opencode");
}

/** Normalize provider/model aliases to a pricing-friendly id. */
export function normalizeOpenCodeModel(raw: string): string {
  let m = raw.trim();
  // Strip common capability suffixes that share the same list price
  m = m.replace(/-(high|medium|low|max|preview|latest)$/i, "");
  if (m.startsWith("anthropic/")) m = m.slice("anthropic/".length);
  if (m.startsWith("openai/")) m = m.slice("openai/".length);
  if (m.startsWith("google/")) m = m.slice("google/".length);
  if (m.startsWith("opencode/")) m = m.slice("opencode/".length);
  return m;
}

export function createOpenCodeAdapter(opts?: { path?: string | null }): Adapter {
  const root = () => openCodeDataDir(opts?.path);

  return {
    source: "opencode",

    async isAvailable() {
      const base = root();
      return (
        existsSync(join(base, "opencode.db")) ||
        existsSync(join(base, "project")) ||
        existsSync(join(base, "storage", "message")) ||
        existsSync(join(base, "global", "storage"))
      );
    },

    async read(since?: number) {
      const base = root();
      const events: UsageEvent[] = [];
      const stats: OpenCodeParseStats = { files: 0, skipped: 0, events: 0, layout: "none" };

      const dbPath = join(base, "opencode.db");
      if (existsSync(dbPath)) {
        stats.layout = "sqlite";
        readSqlite(dbPath, since, events, stats);
        lastStats = stats;
        return events;
      }

      // Current file layout: project/<slug>/storage/ and global/storage/
      const projectRoot = join(base, "project");
      if (existsSync(projectRoot)) {
        stats.layout = "project-storage";
        for (const slug of safeList(projectRoot)) {
          const storage = join(projectRoot, slug, "storage");
          if (existsSync(storage)) readStorageTree(storage, slug, since, events, stats);
        }
        const globalStorage = join(base, "global", "storage");
        if (existsSync(globalStorage)) {
          readStorageTree(globalStorage, "(global)", since, events, stats);
        }
        lastStats = stats;
        return events;
      }

      // Legacy: storage/message/{sessionID}/msg_*.json
      const legacyMsg = join(base, "storage", "message");
      if (existsSync(legacyMsg)) {
        stats.layout = "legacy-message";
        readLegacyMessages(base, since, events, stats);
        lastStats = stats;
        return events;
      }

      lastStats = stats;
      return events;
    },

    watchPaths() {
      const base = root();
      const paths: string[] = [];
      if (existsSync(base)) paths.push(base);
      return paths;
    },
  };
}

function readSqlite(
  dbPath: string,
  since: number | undefined,
  out: UsageEvent[],
  stats: OpenCodeParseStats,
) {
  let db: Database;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch {
    stats.skipped++;
    return;
  }
  try {
    // Message rows hold per-turn tokens; session rows are aggregates — prefer messages
    const rows = db
      .query(
        `SELECT m.id, m.session_id, m.data, s.directory AS project
         FROM message m
         LEFT JOIN session s ON s.id = m.session_id`,
      )
      .all() as Array<{ id: string; session_id: string; data: string; project: string | null }>;

    stats.files = rows.length;
    for (const row of rows) {
      try {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        if (data.role !== "assistant") continue;
        const tokens = data.tokens as Record<string, unknown> | undefined;
        if (!tokens || typeof tokens !== "object") continue;

        const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
        const modelRaw =
          (typeof data.modelID === "string" && data.modelID) ||
          (typeof data.model === "string" && data.model) ||
          "unknown";
        const model = normalizeOpenCodeModel(modelRaw);

        const time = data.time as Record<string, unknown> | undefined;
        const ts =
          typeof time?.created === "number"
            ? time.created
            : typeof time?.completed === "number"
              ? time.completed
              : NaN;
        if (!Number.isFinite(ts)) {
          stats.skipped++;
          continue;
        }
        if (since !== undefined && ts < since) continue;

        const inTok = num(tokens.input);
        const outTok = num(tokens.output) + num(tokens.reasoning);
        const cacheWrite = num(cache.write);
        const cacheRead = num(cache.read);
        const costRaw = data.cost;
        const costReported =
          typeof costRaw === "number" && costRaw > 0 && inTok + outTok + cacheWrite + cacheRead > 0
            ? costRaw
            : undefined;

        out.push({
          id: makeEventId("opencode", row.session_id, row.id),
          ts,
          source: "opencode",
          model,
          sessionId: row.session_id,
          project: row.project ?? undefined,
          tokens: { in: inTok, out: outTok, cacheWrite, cacheRead },
          costReported,
        });
        stats.events++;
      } catch {
        stats.skipped++;
      }
    }
  } finally {
    db.close();
  }
}

function readStorageTree(
  storage: string,
  project: string,
  since: number | undefined,
  out: UsageEvent[],
  stats: OpenCodeParseStats,
) {
  // Walk any msg_*.json under storage
  walkFiles(storage, (file) => {
    if (!file.endsWith(".json")) return;
    const base = file.split("/").pop() ?? "";
    if (!base.startsWith("msg_")) return;
    stats.files++;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const ev = messageToEvent(data, project, file);
      if (!ev) return;
      if (since !== undefined && ev.ts < since) return;
      out.push(ev);
      stats.events++;
    } catch {
      stats.skipped++;
    }
  });
}

function readLegacyMessages(
  base: string,
  since: number | undefined,
  out: UsageEvent[],
  stats: OpenCodeParseStats,
) {
  const msgRoot = join(base, "storage", "message");
  const sessionMeta = new Map<string, string>();

  // session/{projectHash}/{sessionID}.json → project path when present
  const sessRoot = join(base, "storage", "session");
  if (existsSync(sessRoot)) {
    walkFiles(sessRoot, (file) => {
      if (!file.endsWith(".json")) return;
      try {
        const s = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        const id = typeof s.id === "string" ? s.id : file.split("/").pop()?.replace(/\.json$/, "");
        if (!id) return;
        const project =
          (typeof s.directory === "string" && s.directory) ||
          (typeof s.path === "string" && s.path) ||
          undefined;
        if (project) sessionMeta.set(id, project);
      } catch {
        /* ignore */
      }
    });
  }

  for (const sessionId of safeList(msgRoot)) {
    const dir = join(msgRoot, sessionId);
    if (!isDir(dir)) continue;
    for (const name of safeList(dir)) {
      if (!name.startsWith("msg_") || !name.endsWith(".json")) continue;
      const file = join(dir, name);
      stats.files++;
      try {
        const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        const project = sessionMeta.get(sessionId) ?? sessionId;
        const ev = messageToEvent(data, project, file, sessionId);
        if (!ev) continue;
        if (since !== undefined && ev.ts < since) continue;
        out.push(ev);
        stats.events++;
      } catch {
        stats.skipped++;
      }
    }
  }
}

function messageToEvent(
  data: Record<string, unknown>,
  project: string,
  file: string,
  sessionIdHint?: string,
): UsageEvent | null {
  if (data.role && data.role !== "assistant") return null;
  const tokens = data.tokens as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== "object") return null;

  const cache = (tokens.cache as Record<string, unknown> | undefined) ?? {};
  const modelRaw =
    (typeof data.modelID === "string" && data.modelID) ||
    (typeof data.model === "string" && data.model) ||
    "unknown";
  const model = normalizeOpenCodeModel(modelRaw);

  const time = data.time as Record<string, unknown> | undefined;
  let ts =
    typeof time?.created === "number"
      ? time.created
      : typeof data.time?.["created"] === "number"
        ? (data.time as { created: number }).created
        : NaN;
  if (!Number.isFinite(ts)) {
    try {
      ts = Math.floor(statSync(file).mtimeMs);
    } catch {
      return null;
    }
  }

  const sessionId =
    sessionIdHint ||
    (typeof data.sessionID === "string" && data.sessionID) ||
    (typeof data.session_id === "string" && data.session_id) ||
    "unknown";
  const msgId =
    (typeof data.id === "string" && data.id) ||
    file.split("/").pop()?.replace(/\.json$/, "") ||
    "unknown";

  const inTok = num(tokens.input);
  const outTok = num(tokens.output) + num(tokens.reasoning);
  const cacheWrite = num(cache.write);
  const cacheRead = num(cache.read);
  const costRaw = data.cost;
  // OpenCode writes cost:0 even when tokens are present — treat as missing
  const costReported =
    typeof costRaw === "number" && costRaw > 0 && inTok + outTok + cacheWrite + cacheRead > 0
      ? costRaw
      : undefined;

  return {
    id: makeEventId("opencode", sessionId, msgId),
    ts,
    source: "opencode",
    model,
    sessionId,
    project,
    tokens: { in: inTok, out: outTok, cacheWrite, cacheRead },
    costReported,
  };
}

function walkFiles(dir: string, fn: (file: string) => void) {
  for (const name of safeList(dir)) {
    const full = join(dir, name);
    if (isDir(full)) walkFiles(full, fn);
    else fn(full);
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
