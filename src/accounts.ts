import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Source } from "./adapters/types";
import { dataDir, ensureDataDir } from "./config";
import {
  PRIMARY_ACCOUNT_ID,
  type AccountsConfig,
  type ExtraAccount,
} from "./accounts-types";

export {
  PRIMARY_ACCOUNT_ID,
  type AccountsConfig,
  type ExtraAccount,
} from "./accounts-types";

const SOURCES: Source[] = ["claude-code", "opencode", "cursor"];

/** Holds cookies, so it lives beside secrets.json with the same 0600 mode. */
export function accountsPath() {
  return join(dataDir(), "accounts.json");
}

export function loadAccounts(): AccountsConfig {
  ensureDataDir();
  const path = accountsPath();
  if (!existsSync(path)) return { primaryLabels: {}, extra: [] };
  try {
    return normalizeAccounts(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return { primaryLabels: {}, extra: [] };
  }
}

export function saveAccounts(input: unknown): AccountsConfig {
  ensureDataDir();
  const cleaned = normalizeAccounts(input);
  const path = accountsPath();
  writeFileSync(path, JSON.stringify(cleaned, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort
  }
  return cleaned;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function normalizeAccounts(input: unknown): AccountsConfig {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawLabels = (o.primaryLabels && typeof o.primaryLabels === "object"
    ? o.primaryLabels
    : {}) as Record<string, unknown>;

  const primaryLabels: AccountsConfig["primaryLabels"] = {};
  for (const source of SOURCES) {
    const label = str(rawLabels[source]);
    if (label) primaryLabels[source] = label;
  }

  const extra: ExtraAccount[] = [];
  const seen = new Set<string>([PRIMARY_ACCOUNT_ID]);
  const counts: Record<Source, number> = { "claude-code": 1, opencode: 1, cursor: 1 };
  for (const item of Array.isArray(o.extra) ? o.extra : []) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const source = a.source as Source;
    if (!SOURCES.includes(source)) continue;
    counts[source] += 1;

    let id = str(a.id);
    if (!id || seen.has(id)) id = crypto.randomUUID();
    seen.add(id);

    const account: ExtraAccount = {
      id,
      source,
      label: str(a.label) || `${DEFAULT_SHORT_LABEL[source]} ${counts[source]}`,
      cookie: str(a.cookie),
    };
    const plan = str(a.plan);
    if (plan) account.plan = plan;
    if (source === "claude-code") account.orgId = str(a.orgId);
    if (source === "opencode") account.workspaceId = str(a.workspaceId);
    extra.push(account);
  }

  return { primaryLabels, extra };
}

const DEFAULT_SHORT_LABEL: Record<Source, string> = {
  "claude-code": "Claude",
  opencode: "OpenCode",
  cursor: "Cursor",
};
