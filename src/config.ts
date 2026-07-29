import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { AppConfig } from "./adapters/types";
import { home } from "./adapters/util";

export const DATA_DIR = home(".harness-dashboard");

const DEFAULT_CONFIG: AppConfig = {
  plan: "max5x",
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
};

export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function configPath() {
  return join(DATA_DIR, "config.json");
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
  return {
    ...base,
    ...patch,
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
  };
}

export function planMultiplier(plan: AppConfig["plan"]): number {
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
