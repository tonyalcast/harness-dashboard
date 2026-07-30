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

/** @deprecated Prefer ClaudePlan via config.plans["claude-code"]. */
export type Plan = "pro" | "max5x" | "max20x" | "custom";

export type ClaudePlan = "pro" | "max5x" | "max20x" | "custom";
export type OpenCodePlan = "go" | "api" | "custom";
export type CursorPlan = "hobby" | "pro" | "pro-plus" | "ultra" | "business" | "custom";

export type HarnessPlans = {
  "claude-code": ClaudePlan;
  opencode: OpenCodePlan;
  cursor: CursorPlan;
};

export type RefreshMode = "manual" | "live";

export type DashboardSection =
  | "subscriptions"
  | "consumption"
  | "byHarness"
  | "timeSeries"
  | "byModel"
  | "heatmap"
  | "topSessions"
  | "whatIf";

export type DashboardSections = Record<DashboardSection, boolean>;

export type AppConfig = {
  /**
   * Legacy single plan (Anthropic-oriented). Kept in sync with
   * plans["claude-code"] for older callers.
   */
  plan: ClaudePlan;
  plans: HarnessPlans;
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
  /** Manual refresh only (default) vs live file-watch + SSE updates. */
  refreshMode: RefreshMode;
  /** Toggle dashboard sections; hidden sections skip client fetches. */
  sections: DashboardSections;
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
