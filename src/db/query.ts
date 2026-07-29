import type { EventRow, Filter, Source } from "../adapters/types";
import { getDb } from "./schema";

export function queryEvents(filter: Filter): EventRow[] {
  const clauses: string[] = ["ts >= ?", "ts <= ?"];
  const params: (string | number)[] = [filter.range.from, filter.range.to];

  if (filter.sources.length > 0) {
    clauses.push(`source IN (${filter.sources.map(() => "?").join(",")})`);
    params.push(...filter.sources);
  }
  if (filter.models && filter.models.length > 0) {
    clauses.push(`model IN (${filter.models.map(() => "?").join(",")})`);
    params.push(...filter.models);
  }

  const sql = `SELECT * FROM events WHERE ${clauses.join(" AND ")} ORDER BY ts ASC`;
  return getDb().query(sql).all(...params) as EventRow[];
}

export function queryAllEvents(): EventRow[] {
  return getDb().query("SELECT * FROM events ORDER BY ts ASC").all() as EventRow[];
}

export function eventCount(): number {
  const row = getDb().query("SELECT COUNT(*) AS n FROM events").get() as { n: number };
  return row.n;
}

export function distinctModels(): string[] {
  return (getDb().query("SELECT DISTINCT model FROM events ORDER BY model").all() as Array<{
    model: string;
  }>).map((r) => r.model);
}

export function lastIngestAt(): number | null {
  const row = getDb().query("SELECT value FROM meta WHERE key = 'last_ingest_at'").get() as
    | { value: string }
    | null;
  return row ? Number(row.value) : null;
}

export function sourceCounts(): Record<Source, number> {
  const rows = getDb()
    .query("SELECT source, COUNT(*) AS n FROM events GROUP BY source")
    .all() as Array<{ source: Source; n: number }>;
  const out: Record<Source, number> = { "claude-code": 0, opencode: 0, cursor: 0 };
  for (const r of rows) out[r.source] = r.n;
  return out;
}
