import { Database } from "bun:sqlite";
import { join } from "path";
import { dataDir, ensureDataDir } from "../config";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  source        TEXT NOT NULL,
  model         TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  project       TEXT,
  in_tokens     INTEGER NOT NULL DEFAULT 0,
  out_tokens    INTEGER NOT NULL DEFAULT 0,
  cache_write   INTEGER NOT NULL DEFAULT 0,
  cache_read    INTEGER NOT NULL DEFAULT 0,
  cost_reported REAL,
  cost_api      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ts     ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_model ON events(model);

CREATE TABLE IF NOT EXISTS ingest_state (
  file_path TEXT PRIMARY KEY,
  mtime     INTEGER NOT NULL,
  size      INTEGER NOT NULL,
  offset    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: Database | null = null;

export function dbPath() {
  return join(dataDir(), "db.sqlite");
}

export function getDb(): Database {
  if (db) return db;
  ensureDataDir();
  db = new Database(dbPath());
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  db?.close();
  db = null;
}
