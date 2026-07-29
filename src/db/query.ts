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

export type RecordSort = "ts" | "cost" | "tokens" | "model" | "source";

export type RecordQuery = {
  filter: Filter;
  /** Free text over model, session and project. */
  search?: string;
  sort?: RecordSort;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

const SORT_COLUMNS: Record<RecordSort, string> = {
  ts: "ts",
  cost: "cost_api",
  tokens: "(in_tokens + out_tokens + cache_write + cache_read)",
  model: "model",
  source: "source",
};

function recordWhere(q: RecordQuery): { sql: string; params: (string | number)[] } {
  const clauses: string[] = ["ts >= ?", "ts <= ?"];
  const params: (string | number)[] = [q.filter.range.from, q.filter.range.to];

  if (q.filter.sources.length > 0) {
    clauses.push(`source IN (${q.filter.sources.map(() => "?").join(",")})`);
    params.push(...q.filter.sources);
  }
  if (q.filter.models && q.filter.models.length > 0) {
    clauses.push(`model IN (${q.filter.models.map(() => "?").join(",")})`);
    params.push(...q.filter.models);
  }
  const search = q.search?.trim();
  if (search) {
    clauses.push("(model LIKE ? OR session_id LIKE ? OR IFNULL(project, '') LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  return { sql: clauses.join(" AND "), params };
}

/** One page of the raw ledger, sorted and filtered in SQL so it scales. */
export function queryRecords(q: RecordQuery): EventRow[] {
  const { sql, params } = recordWhere(q);
  const col = SORT_COLUMNS[q.sort ?? "ts"];
  const dir = q.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 1000);
  const offset = Math.max(q.offset ?? 0, 0);
  return getDb()
    .query(
      `SELECT * FROM events WHERE ${sql} ORDER BY ${col} ${dir}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as EventRow[];
}

/** Totals across the whole filtered set, not just the current page. */
export function recordTotals(q: RecordQuery): {
  rows: number;
  tokens: number;
  costApi: number;
  costReported: number | null;
  reportedRows: number;
} {
  const { sql, params } = recordWhere(q);
  const row = getDb()
    .query(
      `SELECT COUNT(*) AS rows,
              IFNULL(SUM(in_tokens + out_tokens + cache_write + cache_read), 0) AS tokens,
              IFNULL(SUM(cost_api), 0) AS costApi,
              SUM(cost_reported) AS costReported,
              SUM(CASE WHEN cost_reported IS NOT NULL THEN 1 ELSE 0 END) AS reportedRows
       FROM events WHERE ${sql}`,
    )
    .get(...params) as {
    rows: number;
    tokens: number;
    costApi: number;
    costReported: number | null;
    reportedRows: number;
  };
  return row;
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
