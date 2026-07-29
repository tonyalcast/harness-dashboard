import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, fstatSync } from "fs";
import { join } from "path";
import type { Adapter, UsageEvent } from "./types";
import { decodeClaudeProjectPath, home, makeEventId } from "./util";

export type ClaudeParseStats = { files: number; lines: number; skipped: number; events: number };

let lastStats: ClaudeParseStats = { files: 0, lines: 0, skipped: 0, events: 0 };

export function getClaudeParseStats(): ClaudeParseStats {
  return lastStats;
}

export function projectsDir(override?: string | null): string {
  return override || process.env.CLAUDE_PROJECTS_DIR || home(".claude", "projects");
}

export function createClaudeAdapter(opts?: {
  path?: string | null;
  getOffset?: (file: string) => number;
  setOffset?: (file: string, offset: number, mtime: number, size: number) => void;
}): Adapter {
  const root = () => projectsDir(opts?.path);

  return {
    source: "claude-code",

    async isAvailable() {
      return existsSync(root());
    },

    async read(since?: number) {
      const base = root();
      const stats: ClaudeParseStats = { files: 0, lines: 0, skipped: 0, events: 0 };
      const events: UsageEvent[] = [];
      if (!existsSync(base)) {
        lastStats = stats;
        return events;
      }

      for (const projectEnc of safeList(base)) {
        const projectPath = join(base, projectEnc);
        if (!isDir(projectPath)) continue;
        const project = decodeClaudeProjectPath(projectEnc);
        collectJsonl(projectPath, project, since, opts, events, stats);
      }

      lastStats = stats;
      return events;
    },

    watchPaths() {
      const base = root();
      return existsSync(base) ? [base] : [];
    },
  };
}

function collectJsonl(
  dir: string,
  project: string,
  since: number | undefined,
  opts:
    | {
        getOffset?: (file: string) => number;
        setOffset?: (file: string, offset: number, mtime: number, size: number) => void;
      }
    | undefined,
  out: UsageEvent[],
  stats: ClaudeParseStats,
) {
  for (const name of safeList(dir)) {
    const full = join(dir, name);
    if (isDir(full)) {
      collectJsonl(full, project, since, opts, out, stats);
      continue;
    }
    if (!name.endsWith(".jsonl")) continue;
    const sessionId = name.replace(/\.jsonl$/, "");
    parseFile(full, sessionId, project, since, opts, out, stats);
  }
}

function parseFile(
  file: string,
  sessionId: string,
  project: string,
  since: number | undefined,
  opts:
    | {
        getOffset?: (file: string) => number;
        setOffset?: (file: string, offset: number, mtime: number, size: number) => void;
      }
    | undefined,
  out: UsageEvent[],
  stats: ClaudeParseStats,
) {
  let st;
  try {
    st = statSync(file);
  } catch {
    return;
  }
  stats.files++;
  const size = st.size;
  const mtime = Math.floor(st.mtimeMs);
  const stored = opts?.getOffset?.(file) ?? 0;

  // Skip when mtime/size unchanged and we already reached EOF
  if (stored > 0 && stored >= size) return;

  const start = stored > 0 && stored < size ? stored : 0;
  const content = readTail(file, start);
  if (content === null) return;

  let consumed = start;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;
    const hasNewline = !isLast || content.endsWith("\n");
    // Incomplete final line while a session is live — leave for next tail
    if (isLast && !content.endsWith("\n") && line.length > 0) break;

    consumed += Buffer.byteLength(line, "utf8") + (hasNewline ? 1 : 0);
    if (!line.trim()) continue;
    stats.lines++;
    try {
      const ev = parseLine(line, sessionId, project);
      if (!ev) continue;
      if (since !== undefined && ev.ts < since) continue;
      out.push(ev);
      stats.events++;
    } catch {
      stats.skipped++;
    }
  }

  opts?.setOffset?.(file, Math.min(consumed, size), mtime, size);
}

function readTail(file: string, start: number): string | null {
  try {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (start >= size) return "";
      const len = size - start;
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, start);
      return buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function parseLine(line: string, sessionId: string, project: string): UsageEvent | null {
  const obj = JSON.parse(line) as Record<string, unknown>;
  if (obj.type !== "assistant") return null;
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return null;
  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;

  const messageId = typeof message.id === "string" ? message.id : undefined;
  const requestId = typeof obj.requestId === "string" ? obj.requestId : undefined;
  const uuid = typeof obj.uuid === "string" ? obj.uuid : undefined;
  const idKey = messageId ?? uuid;
  if (!idKey) return null;

  const model = typeof message.model === "string" ? message.model : "unknown";
  const tsRaw = obj.timestamp;
  const ts =
    typeof tsRaw === "string" ? Date.parse(tsRaw) : typeof tsRaw === "number" ? tsRaw : NaN;
  if (!Number.isFinite(ts)) return null;

  const sid =
    (typeof obj.sessionId === "string" && obj.sessionId) ||
    (typeof obj.session_id === "string" && obj.session_id) ||
    sessionId;

  return {
    id: makeEventId("claude-code", sid, idKey, requestId),
    ts,
    source: "claude-code",
    model,
    sessionId: sid,
    project,
    tokens: {
      in: num(usage.input_tokens),
      out: num(usage.output_tokens),
      cacheWrite: num(usage.cache_creation_input_tokens),
      cacheRead: num(usage.cache_read_input_tokens),
    },
  };
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
