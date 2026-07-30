import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type {
  AppConfig,
  ClaudePlan,
  CursorPlan,
  HarnessPlans,
  OpenCodePlan,
  Source,
} from "./adapters/types";
import { DEFAULT_DASHBOARD_SECTIONS, mergeDashboardSections } from "./dashboard-sections";
import { home } from "./adapters/util";

/**
 * Index location. Read lazily so tests can redirect it after import —
 * clearEvents() against a live ~/.harness-dashboard would wipe real data.
 */
export function dataDir(): string {
  return process.env.HARNESS_DASHBOARD_DATA_DIR || home(".harness-dashboard");
}

const DEFAULT_PLANS: HarnessPlans = {
  "claude-code": "max5x",
  opencode: "go",
  cursor: "pro",
};

const DEFAULT_CONFIG: AppConfig = {
  plan: DEFAULT_PLANS["claude-code"],
  plans: { ...DEFAULT_PLANS },
  weeklyBaselineTokens: 0,
  monthlyBudgetUsd: 200,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  currency: "USD",
  adapters: {
    "claude-code": { enabled: true, path: null },
    opencode: { enabled: true, path: null },
    cursor: { enabled: false },
  },
  alerts: { windowPct: 80, weeklyPct: 80, budgetPct: 80 },
  refreshMode: "live",
  sections: { ...DEFAULT_DASHBOARD_SECTIONS },
};

export function ensureDataDir() {
  if (!existsSync(dataDir())) mkdirSync(dataDir(), { recursive: true });
}

export function configPath() {
  return join(dataDir(), "config.json");
}

export function loadConfig(): AppConfig {
  ensureDataDir();
  const path = configPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>;
    return mergeConfig(DEFAULT_CONFIG, raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg: AppConfig) {
  ensureDataDir();
  writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  const next = mergeConfig(loadConfig(), patch);
  saveConfig(next);
  return next;
}

function mergeConfig(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const plans = mergePlans(base.plans, patch);
  return {
    ...base,
    ...patch,
    plan: plans["claude-code"],
    plans,
    adapters: {
      ...base.adapters,
      ...(patch.adapters ?? {}),
      "claude-code": {
        ...base.adapters["claude-code"],
        ...(patch.adapters?.["claude-code"] ?? {}),
      },
      opencode: { ...base.adapters.opencode, ...(patch.adapters?.opencode ?? {}) },
      cursor: { ...base.adapters.cursor, ...(patch.adapters?.cursor ?? {}) },
    },
    alerts: { ...base.alerts, ...(patch.alerts ?? {}) },
    refreshMode: patch.refreshMode ?? base.refreshMode,
    sections: mergeDashboardSections({ ...base.sections, ...(patch.sections ?? {}) }),
  };
}

function mergePlans(base: HarnessPlans, patch: Partial<AppConfig>): HarnessPlans {
  if (patch.plans) {
    return {
      "claude-code": patch.plans["claude-code"] ?? base["claude-code"],
      opencode: patch.plans.opencode ?? base.opencode,
      cursor: patch.plans.cursor ?? base.cursor,
    };
  }
  // Legacy config.json only had a single Anthropic-oriented `plan`.
  return {
    ...base,
    "claude-code": patch.plan ?? base["claude-code"],
  };
}

/** Anthropic-style multiplier — driven by the Claude harness plan. */
export function planMultiplier(plan: ClaudePlan): number {
  switch (plan) {
    case "pro":
      return 1;
    case "max5x":
      return 5;
    case "max20x":
      return 20;
    case "custom":
      return 1;
  }
}

export function planLabel(source: Source, plan: string): string {
  if (source === "claude-code") {
    const map: Record<ClaudePlan, string> = {
      pro: "Pro",
      max5x: "Max 5×",
      max20x: "Max 20×",
      custom: "Custom",
    };
    return map[plan as ClaudePlan] ?? plan;
  }
  if (source === "opencode") {
    const map: Record<OpenCodePlan, string> = {
      go: "Go",
      api: "API keys",
      custom: "Custom",
    };
    return map[plan as OpenCodePlan] ?? plan;
  }
  const map: Record<CursorPlan, string> = {
    hobby: "Hobby",
    pro: "Pro",
    "pro-plus": "Pro Plus",
    ultra: "Ultra",
    business: "Business",
    custom: "Custom",
  };
  return map[plan as CursorPlan] ?? plan;
}
