import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { applyStoredSecrets } from "./secrets";

export const COOKIE_KEYS = [
  "CURSOR_SESSION_COOKIE",
  "CLAUDE_SESSION_COOKIE",
  "CLAUDE_ORG_ID",
  "OPENCODE_GO_WORKSPACE_ID",
  "OPENCODE_GO_AUTH_COOKIE",
] as const;

function dataDir(): string {
  return process.env.HARNESS_DASHBOARD_DATA_DIR || join(homedir(), ".harness-dashboard");
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function applyEnvFile(path: string) {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function resolveProjectRoot(): string | undefined {
  if (process.env.HARNESS_DASHBOARD_ROOT?.trim()) {
    const root = process.env.HARNESS_DASHBOARD_ROOT.trim();
    if (!root.includes(".app/") && !root.endsWith(".asar")) return root;
  }
  const marker = join(dataDir(), "project-root");
  if (!existsSync(marker)) return undefined;
  const root = readFileSync(marker, "utf8").trim();
  if (!root || root.includes(".app/") || root.endsWith(".asar")) return undefined;
  return root;
}

/** Load subscription cookies from every known .env location (first wins per key). */
export function loadHarnessEnv() {
  const explicit = process.env.HARNESS_DASHBOARD_ENV_FILE?.trim();
  if (explicit) applyEnvFile(explicit);

  applyEnvFile(join(dataDir(), ".env"));

  const projectRoot = resolveProjectRoot();
  if (projectRoot) applyEnvFile(join(projectRoot, ".env"));

  applyEnvFile(join(process.cwd(), ".env"));
  applyStoredSecrets();
}

/** Re-read .env files and persisted settings secrets into process.env. */
export function refreshHarnessCredentials() {
  for (const key of COOKIE_KEYS) {
    delete process.env[key];
  }
  loadHarnessEnv();
}

export function harnessEnvStatus() {
  return Object.fromEntries(
    COOKIE_KEYS.map((key) => [key, Boolean(process.env[key]?.trim())]),
  ) as Record<(typeof COOKIE_KEYS)[number], boolean>;
}
