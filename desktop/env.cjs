const { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const COOKIE_KEYS = [
  "CURSOR_SESSION_COOKIE",
  "CLAUDE_SESSION_COOKIE",
  "CLAUDE_ORG_ID",
  "OPENCODE_GO_WORKSPACE_ID",
  "OPENCODE_GO_AUTH_COOKIE",
];

function isValidRepoRoot(root) {
  if (!root) return false;
  const normalized = root.trim();
  if (!normalized || normalized.includes(".app/") || normalized.endsWith(".asar")) {
    return false;
  }
  return existsSync(join(normalized, "package.json"));
}

function parseEnv(content) {
  const out = {};
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

function envFileHasCookies(path) {
  if (!existsSync(path)) return false;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  return COOKIE_KEYS.some((key) => Boolean(parsed[key]?.trim()));
}

function injectEnvFile(env, path) {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!value?.trim()) continue;
    if (env[key] === undefined || env[key] === "") {
      env[key] = value;
    }
  }
}

function readSavedProjectRoot(dataDir) {
  const marker = join(dataDir, "project-root");
  if (!existsSync(marker)) return undefined;
  const saved = readFileSync(marker, "utf8").trim();
  return isValidRepoRoot(saved) ? resolve(saved) : undefined;
}

function discoverRepoRoot(dataDir, resourcesPath) {
  const saved = readSavedProjectRoot(dataDir);
  if (saved) return saved;

  const seeds = [resourcesPath, join(resourcesPath ?? "", "..", "..", "..")].filter(Boolean);
  for (const seed of seeds) {
    let dir = resolve(seed);
    for (let i = 0; i < 10; i++) {
      if (isValidRepoRoot(dir)) return dir;
      dir = resolve(dir, "..");
    }
  }
  return undefined;
}

function rememberProjectRoot(root, dataDir) {
  if (!isValidRepoRoot(root)) return;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, "project-root"), resolve(root), "utf8");
}

/** Copy repo .env into ~/.harness-dashboard when the packaged server needs it. */
function syncEnvToDataDir(repoRoot, dataDir) {
  if (!repoRoot) return;
  const src = join(repoRoot, ".env");
  const dest = join(dataDir, ".env");
  if (!existsSync(src)) return;
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
    return;
  }
  if (envFileHasCookies(src) && !envFileHasCookies(dest)) {
    copyFileSync(src, dest);
  }
}

function buildServerEnv({ repoRoot, dataDir, resourcesPath, extra = {} }) {
  const env = { ...process.env, ...extra };
  const resolvedRepo =
    repoRoot && isValidRepoRoot(repoRoot)
      ? resolve(repoRoot)
      : discoverRepoRoot(dataDir, resourcesPath);

  if (resolvedRepo) {
    env.HARNESS_DASHBOARD_ROOT = resolvedRepo;
    rememberProjectRoot(resolvedRepo, dataDir);
  }

  injectEnvFile(env, join(dataDir, ".env"));
  if (resolvedRepo) injectEnvFile(env, join(resolvedRepo, ".env"));

  const envFile =
    [resolvedRepo ? join(resolvedRepo, ".env") : null, join(dataDir, ".env")]
      .filter(Boolean)
      .find((path) => envFileHasCookies(path)) ??
    [resolvedRepo ? join(resolvedRepo, ".env") : null, join(dataDir, ".env")].find(existsSync);

  if (envFile) env.HARNESS_DASHBOARD_ENV_FILE = envFile;
  return env;
}

module.exports = {
  COOKIE_KEYS,
  buildServerEnv,
  discoverRepoRoot,
  rememberProjectRoot,
  syncEnvToDataDir,
  isValidRepoRoot,
  injectEnvFile,
};
