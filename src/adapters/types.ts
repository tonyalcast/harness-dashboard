export type Source = "claude-code" | "opencode" | "cursor";

export type AdapterStatus = "ok" | "unavailable" | "error" | "disabled";

export type UsageEvent = {
  id: string;
  ts: number;
  source: Source;
  model: string;
  sessionId: string;
  project?: string;
  tokens: { in: number; out: number; cacheWrite: number; cacheRead: number };
  costReported?: number;
  /** Coarse Cursor rows where per-message precision is unavailable. */
  limited?: boolean;
};

export interface Adapter {
  readonly source: Source;
  isAvailable(): Promise<boolean>;
  read(since?: number): Promise<UsageEvent[]>;
  watchPaths(): string[];
}

export type Plan = "pro" | "max5x" | "max20x" | "custom";

export type AppConfig = {
  plan: Plan;
  weeklyBaselineTokens: number;
  monthlyBudgetUsd: number;
  timezone: string;
  currency: string;
  adapters: {
    "claude-code": { enabled: boolean; path: string | null };
    opencode: { enabled: boolean; path: string | null };
    cursor: { enabled: boolean };
  };
  alerts: { windowPct: number; weeklyPct: number; budgetPct: number };
};

export type FilterPreset = "today" | "week" | "month" | "all" | "custom";

export type Filter = {
  range: { from: number; to: number };
  preset: FilterPreset;
  sources: Source[];
  models?: string[];
};

export type EventRow = {
  id: string;
  ts: number;
  source: Source;
  model: string;
  session_id: string;
  project: string | null;
  in_tokens: number;
  out_tokens: number;
  cache_write: number;
  cache_read: number;
  cost_reported: number | null;
  cost_api: number;
};
