import type { UsageEvent } from "../adapters/types";
import { costForEvent } from "../core/pricing";
import { getDb } from "./schema";

export function getIngestOffset(filePath: string): number {
  const row = getDb()
    .query("SELECT offset, mtime, size FROM ingest_state WHERE file_path = ?")
    .get(filePath) as { offset: number; mtime: number; size: number } | null;
  return row?.offset ?? 0;
}

export function getIngestState(filePath: string): {
  offset: number;
  mtime: number;
  size: number;
} | null {
  return (
    (getDb()
      .query("SELECT offset, mtime, size FROM ingest_state WHERE file_path = ?")
      .get(filePath) as { offset: number; mtime: number; size: number } | null) ?? null
  );
}

export function setIngestOffset(filePath: string, offset: number, mtime: number, size: number) {
  getDb()
    .query(
      `INSERT INTO ingest_state (file_path, mtime, size, offset)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, offset=excluded.offset`,
    )
    .run(filePath, mtime, size, offset);
}

export function insertEvents(events: UsageEvent[]): number {
  if (events.length === 0) return 0;
  const db = getDb();
  const stmt = db.query(
    `INSERT OR IGNORE INTO events
      (id, ts, source, model, session_id, project, in_tokens, out_tokens, cache_write, cache_read, cost_reported, cost_api)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let inserted = 0;
  const tx = db.transaction((rows: UsageEvent[]) => {
    for (const e of rows) {
      const costApi = costForEvent(e);
      const info = stmt.run(
        e.id,
        e.ts,
        e.source,
        e.model,
        e.sessionId,
        e.project ?? null,
        e.tokens.in,
        e.tokens.out,
        e.tokens.cacheWrite,
        e.tokens.cacheRead,
        e.costReported ?? null,
        costApi,
      );
      inserted += Number(info.changes);
    }
  });
  tx(events);
  return inserted;
}

export function setMeta(key: string, value: string) {
  getDb()
    .query(
      `INSERT INTO meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    )
    .run(key, value);
}

export function getMeta(key: string): string | null {
  const row = getDb().query("SELECT value FROM meta WHERE key = ?").get(key) as
    | { value: string }
    | null;
  return row?.value ?? null;
}

export function clearEvents() {
  getDb().exec("DELETE FROM events;");
  getDb().exec("DELETE FROM ingest_state;");
}
